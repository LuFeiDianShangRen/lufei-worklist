import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, IncomingMessage, ServerResponse, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { createBackup, mergeBackup, parseBackup } from "../shared/backup";
import { tickTickTaskToReminder } from "../shared/ticktick";
import { AppData, AppSettings, ReminderItem } from "../shared/types";
import { ReminderScheduler } from "./scheduler";
import { ReminderStore } from "./store";
import { authorizeTickTick, fetchTickTickProjectData } from "./ticktick";

export const DESKTOP_WEB_PORT = 38306;

interface DesktopWebServerDeps {
  store: ReminderStore;
  staticRoot: string;
  getScheduler: () => ReminderScheduler | null;
  broadcastDataChanged: (data: AppData) => void;
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function applyCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  applyCors(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, statusCode: number, message: string): void {
  sendJson(response, statusCode, { error: message });
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const raw = await readRequestBody(request);
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

async function serveStatic(response: ServerResponse, staticRoot: string, pathname: string): Promise<void> {
  const root = resolve(staticRoot);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(filePath);
  const contentType = mimeTypes[extension] ?? "application/octet-stream";
  const content = await readFile(filePath);
  response.writeHead(200, { "Content-Type": contentType });
  response.end(content);
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: DesktopWebServerDeps
): Promise<void> {
  if (request.method === "OPTIONS") {
    applyCors(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/app-data") {
    sendJson(response, 200, await deps.store.getData());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reminder") {
    const item = await readJsonBody<ReminderItem>(request);
    const data = await deps.store.upsertReminder(item);
    deps.broadcastDataChanged(data);
    await deps.getScheduler()?.runNow();
    sendJson(response, 200, data);
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/reminder/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/reminder/".length));
    const data = await deps.store.deleteReminder(id);
    deps.broadcastDataChanged(data);
    sendJson(response, 200, data);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const settings = await readJsonBody<AppSettings>(request);
    const data = await deps.store.updateSettings(settings);
    deps.broadcastDataChanged(data);
    await deps.getScheduler()?.runNow();
    sendJson(response, 200, data);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/alert/acknowledge") {
    const { key } = await readJsonBody<{ key: string }>(request);
    const alert = await deps.store.acknowledgeAlert(key);
    const data = await deps.store.getData();
    deps.broadcastDataChanged(data);
    sendJson(response, 200, { alert, data });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/backup") {
    sendJson(response, 200, createBackup(await deps.store.getData()));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backup/import") {
    const { backup: rawBackup, overwrite = false } = await readJsonBody<{ backup: unknown; overwrite?: boolean }>(request);
    const backup = parseBackup(rawBackup);
    const current = await deps.store.getData();
    const conflicts = backup.items.filter((item) => current.reminders.some((existing) => existing.id === item.id)).length;
    const data = await deps.store.replace(mergeBackup(current, backup, overwrite));
    deps.broadcastDataChanged(data);
    await deps.getScheduler()?.runNow();
    sendJson(response, 200, { data, imported: backup.items.length, conflicts, overwrite });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ticktick/connect") {
    const settings = await readJsonBody<AppSettings["tickTickSync"]>(request);
    const accessToken = await authorizeTickTick(settings);
    const current = await deps.store.getData();
    const data = await deps.store.updateSettings({
      ...current.settings,
      tickTickSync: {
        ...settings,
        accessToken,
        lastSyncAt: current.settings.tickTickSync.lastSyncAt
      }
    });
    deps.broadcastDataChanged(data);
    sendJson(response, 200, data);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ticktick/sync") {
    const settings = await readJsonBody<AppSettings["tickTickSync"]>(request);
    const current = await deps.store.getData();
    const syncSettings = {
      ...current.settings.tickTickSync,
      ...settings
    };
    const projectData = await fetchTickTickProjectData(syncSettings);
    const now = new Date();
    const reminders = projectData
      .flatMap((entry) =>
        entry.tasks.map((task) =>
          tickTickTaskToReminder(
            task,
            entry.project,
            current.settings.defaultLeadMinutes,
            current.reminders.find((item) => item.id === `ticktick:${task.projectId}:${task.id}`),
            now
          )
        )
      )
      .filter((item): item is ReminderItem => Boolean(item));
    const skipped = projectData.reduce((count, entry) => count + entry.tasks.length, 0) - reminders.length;
    const result = await deps.store.upsertReminders(reminders);
    const data = await deps.store.updateSettings({
      ...result.data.settings,
      tickTickSync: {
        ...syncSettings,
        lastSyncAt: now.toISOString()
      }
    });
    deps.broadcastDataChanged(data);
    await deps.getScheduler()?.runNow();
    sendJson(response, 200, {
      data,
      imported: result.imported,
      updated: result.updated,
      skipped,
      projects: projectData.length
    });
    return;
  }

  sendError(response, 404, "接口不存在。");
}

export function startDesktopWebServer(deps: DesktopWebServerDeps): Promise<Server | null> {
  return new Promise((resolveServer) => {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

        try {
          if (url.pathname.startsWith("/api/")) {
            await handleApiRequest(request, response, url, deps);
            return;
          }

          await serveStatic(response, deps.staticRoot, decodeURIComponent(url.pathname));
        } catch (error) {
          sendError(response, 500, error instanceof Error ? error.message : String(error));
        }
      })();
    });

    server.once("error", () => resolveServer(null));
    server.listen(DESKTOP_WEB_PORT, "127.0.0.1", () => resolveServer(server));
  });
}

export function desktopWebUrl(): string {
  return `http://127.0.0.1:${DESKTOP_WEB_PORT}/`;
}
