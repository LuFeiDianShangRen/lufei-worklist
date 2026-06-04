import type { ReminderApi } from "../preload/preload";
import { createBackup, mergeBackup, parseBackup } from "../shared/backup";
import { MINUTE_MS } from "../shared/date";
import {
  buildAlertKey,
  getAcknowledgeSnoozeMinutes,
  getDueAlerts,
  getNextOccurrenceAfter,
  getUnconfirmedAlerts,
  IN_PROGRESS_SNOOZE_MINUTES,
  isAlertSnoozed,
  isInProgressReminder,
  isRecurringReminder
} from "../shared/scheduler";
import {
  AlertOccurrence,
  AlertRecord,
  AppData,
  AppSettings,
  defaultSettings,
  ReminderBackup,
  ReminderItem,
  TickTickSyncResult
} from "../shared/types";

const STORAGE_KEY = "lufei-worklist-web-data-v1";
const ALERT_CONTAINER_ID = "web-alert-stage";
const DESKTOP_API_BASE = "http://127.0.0.1:38306";
const listeners = new Set<(data: AppData) => void>();
let dataCache: AppData | null = null;
let schedulerStarted = false;
let schedulerTicking = false;
let schedulerQueued = false;
let desktopApiCheck: Promise<boolean> | null = null;
let desktopPollingStarted = false;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 900): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function hasDesktopApi(): Promise<boolean> {
  if (!desktopApiCheck) {
    desktopApiCheck = fetchWithTimeout(`${DESKTOP_API_BASE}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);
  }

  return desktopApiCheck;
}

async function desktopJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DESKTOP_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "桌面数据接口请求失败。" }));
    throw new Error(error.error ?? "桌面数据接口请求失败。");
  }

  return (await response.json()) as T;
}

async function getDesktopData(): Promise<AppData> {
  const data = await desktopJson<AppData>("/api/app-data");
  emitDataChanged(data);
  return data;
}

function normalizeReminder(item: ReminderItem, settings: AppSettings): ReminderItem {
  const normalizedItem = normalizeProgressFields(item);

  if (!normalizedItem.completedAt || !isRecurringReminder(normalizedItem)) {
    return normalizedItem;
  }

  const completedAt = new Date(normalizedItem.completedAt).getTime();
  const startAt = new Date(normalizedItem.startAt).getTime();
  const nextOccurrence = getNextOccurrenceAfter(
    {
      ...normalizedItem,
      completedAt: null,
      enabled: true,
      progressStatus: "todo",
      progressSnoozedUntil: null
    },
    new Date(Math.max(completedAt, startAt)),
    settings
  );

  if (!nextOccurrence) {
    return normalizedItem;
  }

  return {
    ...normalizedItem,
    startAt: nextOccurrence.toISOString(),
    completedAt: null,
    enabled: true,
    progressStatus: "todo",
    progressSnoozedUntil: null
  };
}

function normalizeProgressFields(item: ReminderItem): ReminderItem {
  if (item.completedAt) {
    return {
      ...item,
      progressStatus: "todo",
      progressSnoozedUntil: null
    };
  }

  if (item.progressStatus === "inProgress") {
    return {
      ...item,
      progressStatus: "inProgress",
      progressSnoozedUntil: item.progressSnoozedUntil ?? null
    };
  }

  return {
    ...item,
    progressStatus: "todo",
    progressSnoozedUntil: null
  };
}

function ensureInProgressAlert(data: AppData, item: ReminderItem, nowIso: string): void {
  if (!isInProgressReminder(item)) {
    return;
  }

  const now = new Date(nowIso);
  const snoozedUntil =
    item.progressSnoozedUntil && new Date(item.progressSnoozedUntil).getTime() > now.getTime()
      ? item.progressSnoozedUntil
      : new Date(now.getTime() + IN_PROGRESS_SNOOZE_MINUTES * MINUTE_MS).toISOString();
  const leadMinutes = item.leadMinutes[0] ?? 15;
  const key = buildAlertKey(item.id, item.startAt, leadMinutes);
  const existing = data.alerts[key];

  item.progressSnoozedUntil = snoozedUntil;
  data.alerts[key] = {
    key,
    itemId: item.id,
    occurrenceAt: item.startAt,
    remindAt: existing?.remindAt ?? nowIso,
    leadMinutes,
    triggeredAt: existing?.triggeredAt ?? nowIso,
    lastShownAt: existing?.lastShownAt ?? nowIso,
    confirmedAt: null,
    snoozedUntil
  };
}

function normalizeData(value: Partial<AppData> | null): AppData {
  const settings = {
    ...defaultSettings(),
    ...value?.settings,
    holidayOverrides: {
      ...defaultSettings().holidayOverrides,
      ...value?.settings?.holidayOverrides
    },
    tickTickSync: {
      ...defaultSettings().tickTickSync,
      ...value?.settings?.tickTickSync
    }
  };
  const reminders = Array.isArray(value?.reminders) ? value.reminders : [];

  return {
    version: 1,
    reminders: reminders.map((item) => normalizeReminder(item, settings)),
    alerts: value?.alerts ?? {},
    settings
  };
}

function loadData(): AppData {
  if (dataCache) {
    return dataCache;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    dataCache = normalizeData(raw ? JSON.parse(raw) : null);
  } catch {
    dataCache = normalizeData(null);
  }

  return dataCache;
}

function saveData(data: AppData): AppData {
  dataCache = normalizeData(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataCache));
  emitDataChanged(dataCache);
  return dataCache;
}

function emitDataChanged(data: AppData): void {
  for (const listener of listeners) {
    listener(data);
  }
}

function queueSchedulerRun(): void {
  if (schedulerQueued) {
    return;
  }

  schedulerQueued = true;
  window.setTimeout(() => {
    schedulerQueued = false;
    void runBrowserScheduler();
  }, 0);
}

function acknowledgeBrowserAlert(key: string): AlertRecord | null {
  const data = loadData();
  const existing = data.alerts[key];

  if (!existing) {
    return null;
  }

  const item = data.reminders.find((reminder) => reminder.id === existing.itemId);
  const now = new Date();
  const snoozedUntil = new Date(now.getTime() + getAcknowledgeSnoozeMinutes(item) * MINUTE_MS).toISOString();

  existing.lastShownAt = now.toISOString();
  existing.confirmedAt = null;
  existing.snoozedUntil = snoozedUntil;

  if (isInProgressReminder(item)) {
    item.progressSnoozedUntil = snoozedUntil;
    item.updatedAt = now.toISOString();
  }

  saveData(data);
  return existing;
}

function markAlertShown(data: AppData, alert: AlertOccurrence, now: Date): void {
  const existing = data.alerts[alert.key];
  data.alerts[alert.key] = {
    key: alert.key,
    itemId: alert.itemId,
    occurrenceAt: alert.occurrenceAt,
    remindAt: alert.remindAt,
    leadMinutes: alert.leadMinutes,
    triggeredAt: existing?.triggeredAt ?? now.toISOString(),
    lastShownAt: now.toISOString(),
    confirmedAt: existing?.confirmedAt ?? null,
    snoozedUntil:
      existing?.snoozedUntil && new Date(existing.snoozedUntil).getTime() > now.getTime()
        ? existing.snoozedUntil
        : null
  };
}

function getAlertContainer(): HTMLDivElement {
  const existing = document.getElementById(ALERT_CONTAINER_ID);

  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const container = document.createElement("div");
  container.id = ALERT_CONTAINER_ID;
  container.className = "web-alert-stage";
  document.body.appendChild(container);
  return container;
}

function closeBrowserAlert(key: string): void {
  const element = document.querySelector<HTMLElement>(`.web-floating-alert[data-alert-key="${CSS.escape(key)}"]`);
  element?.remove();
}

function showBrowserAlert(alert: AlertOccurrence): void {
  if (document.querySelector(`.web-floating-alert[data-alert-key="${CSS.escape(alert.key)}"]`)) {
    return;
  }

  const container = getAlertContainer();
  const element = document.createElement("div");
  element.className = "web-floating-alert";
  element.dataset.alertKey = alert.key;
  element.innerHTML = `
    <span class="web-alert-copy">
      <strong></strong>
      <small></small>
      <em></em>
    </span>
    <button type="button">我马上去做</button>
  `;

  const title = element.querySelector("strong");
  const detail = element.querySelector("small");
  const description = element.querySelector("em");
  const button = element.querySelector("button");
  if (title) {
    title.textContent = alert.title;
  }
  if (detail) {
    detail.textContent = `提前 ${alert.leadMinutes} 分钟 · ${new Date(alert.occurrenceAt).toLocaleString()}`;
  }
  if (description) {
    description.textContent = alert.description;
    description.hidden = !alert.description;
  }
  button?.addEventListener("click", () => {
    acknowledgeBrowserAlert(alert.key);
    closeBrowserAlert(alert.key);
  });
  container.appendChild(element);

  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(alert.title || "提醒", {
      body: `提前 ${alert.leadMinutes} 分钟：${new Date(alert.occurrenceAt).toLocaleString()}`
    });
  }
}

async function runBrowserScheduler(): Promise<void> {
  if (schedulerTicking) {
    return;
  }

  schedulerTicking = true;
  try {
    const data = loadData();
    const now = new Date();
    const windowStart = data.settings.lastSchedulerCheckAt
      ? new Date(data.settings.lastSchedulerCheckAt)
      : new Date(now.getTime() - 24 * 60 * MINUTE_MS);
    const due = getDueAlerts(data.reminders, data.alerts, data.settings, now, windowStart);
    const unconfirmed = getUnconfirmedAlerts(data.reminders, data.alerts, now);
    const repeatAfter = Math.max(10, data.settings.overlayRepeatSeconds) * 1_000;
    let changed = false;

    for (const alert of [...due, ...unconfirmed]) {
      const current = data.alerts[alert.key];
      if (isAlertSnoozed(current, now)) {
        continue;
      }

      if (current?.lastShownAt && now.getTime() - new Date(current.lastShownAt).getTime() < repeatAfter) {
        continue;
      }

      markAlertShown(data, alert, now);
      showBrowserAlert(alert);
      changed = true;
    }

    data.settings.lastSchedulerCheckAt = now.toISOString();
    changed = true;

    if (changed) {
      saveData(data);
    }
  } finally {
    schedulerTicking = false;
  }
}

function startBrowserScheduler(): void {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  window.setInterval(() => {
    void runBrowserScheduler();
  }, 15_000);
  queueSchedulerRun();
}

function startDesktopPolling(): void {
  if (desktopPollingStarted) {
    return;
  }

  desktopPollingStarted = true;
  window.setInterval(() => {
    void getDesktopData().catch(() => undefined);
  }, 3_000);
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function chooseJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] ?? null);
        input.remove();
      },
      { once: true }
    );
    input.click();
  });
}

function installBrowserReminderApi(): void {
  if (window.reminderApi) {
    return;
  }

  const api: ReminderApi = {
    getData: async () => {
      if (await hasDesktopApi()) {
        startDesktopPolling();
        return getDesktopData();
      }

      startBrowserScheduler();
      return loadData();
    },
    saveReminder: async (item: ReminderItem) => {
      if (await hasDesktopApi()) {
        startDesktopPolling();
        return desktopJson<AppData>("/api/reminder", {
          method: "POST",
          body: JSON.stringify(item)
        });
      }

      const data = loadData();
      const index = data.reminders.findIndex((existing) => existing.id === item.id);
      const now = new Date().toISOString();
      const nextItem = normalizeProgressFields({ ...item, updatedAt: now });
      ensureInProgressAlert(data, nextItem, now);

      if (index >= 0) {
        data.reminders[index] = nextItem;
      } else {
        data.reminders.push(nextItem);
      }

      const next = saveData(data);
      queueSchedulerRun();
      return next;
    },
    deleteReminder: async (id: string) => {
      if (await hasDesktopApi()) {
        startDesktopPolling();
        return desktopJson<AppData>(`/api/reminder/${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
      }

      const data = loadData();
      data.reminders = data.reminders.filter((item) => item.id !== id);
      for (const key of Object.keys(data.alerts)) {
        if (data.alerts[key].itemId === id) {
          delete data.alerts[key];
          closeBrowserAlert(key);
        }
      }

      return saveData(data);
    },
    saveSettings: async (settings: AppSettings) => {
      if (await hasDesktopApi()) {
        startDesktopPolling();
        return desktopJson<AppData>("/api/settings", {
          method: "POST",
          body: JSON.stringify(settings)
        });
      }

      const data = loadData();
      data.settings = { ...data.settings, ...settings };
      const next = saveData(data);
      queueSchedulerRun();
      return next;
    },
    connectTickTick: async (settings: AppSettings["tickTickSync"]) => {
      if (await hasDesktopApi()) {
        startDesktopPolling();
        return desktopJson<AppData>("/api/ticktick/connect", {
          method: "POST",
          body: JSON.stringify(settings)
        });
      }

      throw new Error("网页离线模式暂不支持滴答清单 OAuth 连接，请先打开桌面版。");
    },
    syncTickTick: async (settings: AppSettings["tickTickSync"]): Promise<TickTickSyncResult> => {
      if (await hasDesktopApi()) {
        startDesktopPolling();
        return desktopJson<TickTickSyncResult>("/api/ticktick/sync", {
          method: "POST",
          body: JSON.stringify(settings)
        });
      }

      throw new Error("网页离线模式暂不支持滴答清单同步，请先打开桌面版。");
    },
    exportBackup: async () => {
      const filename = `reminder-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const backup = (await hasDesktopApi()) ? await desktopJson<ReminderBackup>("/api/backup") : createBackup(loadData());
      downloadTextFile(filename, `${JSON.stringify(backup, null, 2)}\n`);
      return { canceled: false, filePath: filename };
    },
    importBackup: async () => {
      const file = await chooseJsonFile();
      if (!file) {
        return { canceled: true };
      }

      const backup = parseBackup(JSON.parse(await file.text()));
      const current = (await hasDesktopApi()) ? await getDesktopData() : loadData();
      const conflicts = backup.items.filter((item) => current.reminders.some((existing) => existing.id === item.id)).length;
      const overwrite = conflicts > 0 ? window.confirm(`发现 ${conflicts} 个同 ID 事项，是否用备份覆盖？`) : false;
      if (await hasDesktopApi()) {
        startDesktopPolling();
        const result = await desktopJson<{
          data: AppData;
          imported: number;
          conflicts: number;
          overwrite: boolean;
        }>("/api/backup/import", {
          method: "POST",
          body: JSON.stringify({ backup, overwrite })
        });
        emitDataChanged(result.data);
        return { canceled: false, imported: result.imported, conflicts: result.conflicts, overwrite: result.overwrite };
      }

      const next = saveData(mergeBackup(current, backup, overwrite));
      dataCache = next;
      queueSchedulerRun();
      return { canceled: false, imported: backup.items.length, conflicts, overwrite };
    },
    acknowledgeAlert: async (key: string) => {
      if (await hasDesktopApi()) {
        await desktopJson<{ alert: AlertRecord | null; data: AppData }>("/api/alert/acknowledge", {
          method: "POST",
          body: JSON.stringify({ key })
        });
        return;
      }

      acknowledgeBrowserAlert(key);
    },
    performMenuAction: async (action: string) => {
      if (action === "file-about") {
        window.alert("路飞工作清单\n版本：1.0.6\n版权公告：路飞版权所有");
        return;
      }
      if (action === "file-web") {
        window.location.href = `${DESKTOP_API_BASE}/`;
        return;
      }
      if (action === "file-exit") {
        window.close();
        return;
      }
      if (action === "view-reload" || action === "view-force-reload") {
        window.location.reload();
        return;
      }
      if (action === "view-toggle-fullscreen") {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
        return;
      }
      if (action === "view-exit-fullscreen" && document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      const command = action.replace("edit-", "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      if (command !== action) {
        document.execCommand(command);
      }
    },
    onDataChanged: (callback: (data: AppData) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    onFocusReminder: () => () => undefined,
    onOverlayAlert: () => () => undefined,
    acknowledgeOverlay: (key: string) => {
      void api.acknowledgeAlert(key);
      closeBrowserAlert(key);
    },
    setOverlayInteractive: () => undefined
  };

  window.reminderApi = api;
  void hasDesktopApi().then((available) => {
    if (available) {
      startDesktopPolling();
      void getDesktopData();
      return;
    }

    startBrowserScheduler();
  });
}

installBrowserReminderApi();
