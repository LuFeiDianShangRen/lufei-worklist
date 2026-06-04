import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { connect, createServer as createNetServer, type Server } from "node:net";
import { join } from "node:path";
import { createBackup, mergeBackup, parseBackup } from "../shared/backup";
import { tickTickTaskToReminder } from "../shared/ticktick";
import { AlertOccurrence, AppData, AppSettings, ReminderItem } from "../shared/types";
import { ReminderScheduler } from "./scheduler";
import { ReminderStore } from "./store";
import { authorizeTickTick, fetchTickTickProjectData } from "./ticktick";
import { createTrayIconPng } from "./trayIcon";
import { desktopWebUrl, startDesktopWebServer } from "./webServer";

const appId = "com.lufei.strongworklist";
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererRoot = isDev ? process.env.VITE_DEV_SERVER_URL! : join(__dirname, "..", "..", "dist");
const preloadPath = join(__dirname, "..", "preload", "preload.js");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let scheduler: ReminderScheduler;
let desktopWebServer: HttpServer | null = null;
let pendingSecondInstanceShow = false;
let singleInstanceServer: Server | null = null;
let lastDisplayMode: AppSettings["lastDisplayMode"] | null = null;
let displayModeSaveTimer: NodeJS.Timeout | null = null;
const store = new ReminderStore();
const overlayWindows = new Map<string, BrowserWindow[]>();
const overlayWindowKeys = new Map<number, string>();
const singleInstancePipePath =
  process.platform === "win32"
    ? "\\\\.\\pipe\\lufei-worklist-single-instance"
    : join(app.getPath("temp"), "lufei-worklist-single-instance.sock");

app.setName("路飞工作清单");
if (process.platform === "win32") {
  app.setAppUserModelId(appId);
}

function loadAppIcon(size?: number): Electron.NativeImage {
  const image = nativeImage.createFromPath(join(app.getAppPath(), "assets", "app-icon.ico"));
  const fallback = image.isEmpty()
    ? nativeImage.createFromPath(join(app.getAppPath(), "assets", "app-icon.png"))
    : image;
  const icon = fallback.isEmpty() ? nativeImage.createFromBuffer(createTrayIconPng(size ?? 32)) : fallback;
  const resized = size ? icon.resize({ width: size, height: size, quality: "best" }) : icon;
  resized.setTemplateImage(false);
  return resized;
}

function showAboutDialog(): void {
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "关于路飞清单",
    message: "路飞工作清单",
    detail: `版本：${app.getVersion()}\n版权公告：路飞版权所有`,
    buttons: ["确定"],
    icon: loadAppIcon(64)
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    void dialog.showMessageBox(mainWindow, options);
    return;
  }

  void dialog.showMessageBox(options);
}

function createApplicationMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        { label: "打开主窗口", click: () => showMainWindow() },
        { label: "打开网页版", click: () => openDesktopWebVersion() },
        { label: "关于路飞清单", click: () => showAboutDialog() },
        { type: "separator" },
        {
          label: "退出",
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo", accelerator: "Ctrl+Z" },
        { label: "重做", role: "redo", accelerator: "Ctrl+Y" },
        { type: "separator" },
        { label: "剪切", role: "cut", accelerator: "Ctrl+X" },
        { label: "复制", role: "copy", accelerator: "Ctrl+C" },
        { label: "粘贴", role: "paste", accelerator: "Ctrl+V" },
        { label: "删除", role: "delete" },
        { type: "separator" },
        { label: "全选", role: "selectAll", accelerator: "Ctrl+A" }
      ]
    },
    {
      label: "视窗",
      submenu: [
        { label: "重新加载", role: "reload", accelerator: "Ctrl+R" },
        { label: "强制重新加载", role: "forceReload", accelerator: "Ctrl+Shift+R" },
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn", accelerator: "Ctrl+=" },
        { label: "缩小", role: "zoomOut", accelerator: "Ctrl+-" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen", accelerator: "F11" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭窗口", role: "close" },
        { type: "separator" },
        { label: "打开主窗口", click: () => showMainWindow() }
      ]
    }
  ]);
}

function createTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(loadAppIcon(32));
  tray.setToolTip("路飞工作清单");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开路飞工作清单", click: () => showMainWindow() },
      { label: "打开网页版", click: () => openDesktopWebVersion() },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
}

function openDesktopWebVersion(): void {
  void shell.openExternal(desktopWebUrl());
}

async function createMainWindow(hidden = false): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "路飞工作清单",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fbfbfa",
      symbolColor: "#111111",
      height: 34
    },
    icon: loadAppIcon(256),
    backgroundColor: "#f7f8f5",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL(rendererRoot);
  } else {
    await mainWindow.loadFile(join(rendererRoot, "index.html"));
  }

  mainWindow.on("close", (event) => {
    if (quitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
    scheduleDisplayModeSave("tray");
  });

  mainWindow.on("show", () => {
    scheduleDisplayModeSave("visible");
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    if (input.key === "F11") {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      return;
    }

    if (input.key === "Escape" && mainWindow?.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });

  if (!hidden) {
    mainWindow.show();
  }
}

function showMainWindow(selectedReminderId?: string): void {
  void createMainWindow(false).then(() => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    if (selectedReminderId) {
      mainWindow.webContents.send("reminder:focus", selectedReminderId);
    }
  });
}

function showMainWindowWhenReady(): void {
  if (app.isReady()) {
    showMainWindow();
    return;
  }

  pendingSecondInstanceShow = true;
}

function notifyExistingInstance(): Promise<void> {
  return new Promise((resolve) => {
    const client = connect(singleInstancePipePath, () => {
      client.end("show");
      resolve();
    });

    client.once("error", () => resolve());
    client.setTimeout(1000, () => {
      client.destroy();
      resolve();
    });
  });
}

function acquireRuntimeLock(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer((socket) => {
      socket.resume();
      showMainWindowWhenReady();
    });

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        void notifyExistingInstance().finally(() => resolve(false));
        return;
      }

      resolve(false);
    });

    server.listen(singleInstancePipePath, () => {
      singleInstanceServer = server;
      resolve(true);
    });
  });
}

async function applyLoginItemSettings(settings: AppSettings): Promise<void> {
  app.setLoginItemSettings({
    openAtLogin: settings.startAtLogin,
    args: ["--hidden"]
  });
}

function scheduleDisplayModeSave(mode: AppSettings["lastDisplayMode"]): void {
  if (lastDisplayMode === mode) {
    return;
  }

  lastDisplayMode = mode;

  if (displayModeSaveTimer) {
    clearTimeout(displayModeSaveTimer);
  }

  displayModeSaveTimer = setTimeout(() => {
    displayModeSaveTimer = null;
    void store
      .getData()
      .then((data) => {
        if (data.settings.lastDisplayMode === mode) {
          return data;
        }
        return store.updateSettings({ ...data.settings, lastDisplayMode: mode });
      })
      .catch(() => undefined);
  }, 500);
}

function createOverlayWindow(alert: AlertOccurrence, displayBounds: Electron.Rectangle): BrowserWindow {
  const height = 112;
  const overlay = new BrowserWindow({
    x: displayBounds.x,
    y: displayBounds.y + Math.round((displayBounds.height - height) / 2),
    width: displayBounds.width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  overlayWindowKeys.set(overlay.id, alert.key);

  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });

  const loadPromise = isDev
    ? overlay.loadURL(`${rendererRoot}/overlay.html`)
    : overlay.loadFile(join(rendererRoot, "overlay.html"));

  void loadPromise.then(() => {
    overlay.webContents.send("overlay:alert", alert);
    overlay.showInactive();
  });

  overlay.on("closed", () => {
    overlayWindowKeys.delete(overlay.id);
    const windows = overlayWindows.get(alert.key);

    if (!windows) {
      return;
    }

    const remainingWindows = windows.filter((window) => window !== overlay && !window.isDestroyed());

    if (remainingWindows.length > 0) {
      overlayWindows.set(alert.key, remainingWindows);
      return;
    }

    overlayWindows.delete(alert.key);
  });

  return overlay;
}

function closeOverlayWindows(key: string): void {
  const trackedWindows = overlayWindows.get(key) ?? [];
  const keyedWindows = BrowserWindow.getAllWindows().filter((window) => overlayWindowKeys.get(window.id) === key);
  const windows = Array.from(new Set([...trackedWindows, ...keyedWindows])).filter((window) => !window.isDestroyed());
  overlayWindows.delete(key);

  for (const window of windows) {
    overlayWindowKeys.delete(window.id);
    window.close();
  }
}

async function showAlert(alert: AlertOccurrence): Promise<void> {
  const data = await store.getData();
  const existingWindows = (overlayWindows.get(alert.key) ?? []).filter((window) => !window.isDestroyed());

  if (existingWindows.length > 0) {
    overlayWindows.set(alert.key, existingWindows);
    return;
  }

  if (data.settings.soundEnabled) {
    shell.beep();
  }

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: alert.title || "提醒",
      body: `提前 ${alert.leadMinutes} 分钟：${new Date(alert.occurrenceAt).toLocaleString()}`,
      icon: loadAppIcon(64)
    });
    notification.on("click", () => showMainWindow(alert.itemId));
    notification.show();
  }

  closeOverlayWindows(alert.key);

  const windows = screen.getAllDisplays().map((display) => createOverlayWindow(alert, display.bounds));
  overlayWindows.set(alert.key, windows);
}

function broadcastDataChanged(data: AppData): void {
  mainWindow?.webContents.send("app-data:changed", data);
}

function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options);
}

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

function showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

function performMenuAction(action: string, sourceWindow: BrowserWindow | null): void {
  const target = sourceWindow && !sourceWindow.isDestroyed() ? sourceWindow : mainWindow;

  if (action === "file-open") {
    showMainWindow();
    return;
  }

  if (action === "file-web") {
    openDesktopWebVersion();
    return;
  }

  if (action === "file-about") {
    showAboutDialog();
    return;
  }

  if (action === "file-exit") {
    quitting = true;
    app.quit();
    return;
  }

  if (!target || target.isDestroyed()) {
    return;
  }

  const webContents = target.webContents;
  const actions: Record<string, () => void> = {
    "edit-undo": () => webContents.undo(),
    "edit-redo": () => webContents.redo(),
    "edit-cut": () => webContents.cut(),
    "edit-copy": () => webContents.copy(),
    "edit-paste": () => webContents.paste(),
    "edit-delete": () => webContents.delete(),
    "edit-select-all": () => webContents.selectAll(),
    "view-reload": () => webContents.reload(),
    "view-force-reload": () => webContents.reloadIgnoringCache(),
    "view-reset-zoom": () => webContents.setZoomLevel(0),
    "view-zoom-in": () => webContents.setZoomLevel(webContents.getZoomLevel() + 0.5),
    "view-zoom-out": () => webContents.setZoomLevel(webContents.getZoomLevel() - 0.5),
    "view-toggle-fullscreen": () => target.setFullScreen(!target.isFullScreen()),
    "view-exit-fullscreen": () => target.setFullScreen(false),
    "window-minimize": () => target.minimize(),
    "window-close": () => target.close(),
    "window-open": () => showMainWindow()
  };

  actions[action]?.();
}

function registerIpc(): void {
  ipcMain.handle("app-data:get", async () => store.getData());

  ipcMain.handle("reminder:save", async (_event, item: ReminderItem) => {
    const data = await store.upsertReminder(item);
    broadcastDataChanged(data);
    await scheduler.runNow();
    return data;
  });

  ipcMain.handle("reminder:delete", async (_event, id: string) => {
    const data = await store.deleteReminder(id);
    broadcastDataChanged(data);
    return data;
  });

  ipcMain.handle("settings:save", async (_event, settings: AppSettings) => {
    const data = await store.updateSettings(settings);
    await applyLoginItemSettings(data.settings);
    broadcastDataChanged(data);
    return data;
  });

  ipcMain.handle("ticktick:connect", async (_event, settings: AppSettings["tickTickSync"]) => {
    const accessToken = await authorizeTickTick(settings);
    const current = await store.getData();
    const data = await store.updateSettings({
      ...current.settings,
      tickTickSync: {
        ...settings,
        accessToken,
        lastSyncAt: current.settings.tickTickSync.lastSyncAt
      }
    });
    broadcastDataChanged(data);
    return data;
  });

  ipcMain.handle("ticktick:sync", async (_event, settings: AppSettings["tickTickSync"]) => {
    const current = await store.getData();
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
    const result = await store.upsertReminders(reminders);
    const data = await store.updateSettings({
      ...result.data.settings,
      tickTickSync: {
        ...syncSettings,
        lastSyncAt: now.toISOString()
      }
    });
    broadcastDataChanged(data);
    await scheduler.runNow();
    return {
      data,
      imported: result.imported,
      updated: result.updated,
      skipped,
      projects: projectData.length
    };
  });

  ipcMain.handle("backup:export", async () => {
    const data = await store.getData();
    const result = await showSaveDialog({
      title: "导出提醒备份",
      defaultPath: `reminder-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await writeFile(result.filePath, `${JSON.stringify(createBackup(data), null, 2)}\n`, "utf8");
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("backup:import", async () => {
    const result = await showOpenDialog({
      title: "导入提醒备份",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }

    const raw = await readFile(result.filePaths[0], "utf8");
    const backup = parseBackup(JSON.parse(raw));
    const current = await store.getData();
    const conflictCount = backup.items.filter((item) => current.reminders.some((existing) => existing.id === item.id)).length;
    let overwrite = false;

    if (conflictCount > 0) {
      const answer = await showMessageBox({
        type: "question",
        title: "导入冲突",
        message: `发现 ${conflictCount} 个同 ID 事项。`,
        detail: "选择是否用备份内容覆盖本机同 ID 事项。",
        buttons: ["覆盖同 ID", "保留本机"],
        defaultId: 0,
        cancelId: 1
      });
      overwrite = answer.response === 0;
    }

    const merged = mergeBackup(current, backup, overwrite);
    const data = await store.replace(merged);
    await applyLoginItemSettings(data.settings);
    broadcastDataChanged(data);
    await scheduler.runNow();
    return { canceled: false, imported: backup.items.length, conflicts: conflictCount, overwrite };
  });

  ipcMain.handle("alert:acknowledge", async (_event, key: string) => {
    const alert = await store.acknowledgeAlert(key);
    const data = await store.getData();
    broadcastDataChanged(data);
    return alert;
  });

  ipcMain.handle("menu:action", async (event, action: string) => {
    performMenuAction(action, BrowserWindow.fromWebContents(event.sender));
  });

  ipcMain.on("overlay:acknowledge", (_event, key: string) => {
    closeOverlayWindows(key);
    void store
      .acknowledgeAlert(key)
      .then(() => store.getData())
      .then((data) => broadcastDataChanged(data));
  });

  ipcMain.on("overlay:interactive", (event, interactive: boolean) => {
    const overlay = BrowserWindow.fromWebContents(event.sender);

    if (!overlay || overlay.isDestroyed() || !overlay.webContents.getURL().includes("overlay.html")) {
      return;
    }

    if (interactive) {
      overlay.setIgnoreMouseEvents(false);
      return;
    }

    overlay.setIgnoreMouseEvents(true, { forward: true });
  });
}

function registerAppLifecycle(): void {
  app.on("second-instance", (_event, argv) => {
    if (!argv.includes("--hidden")) {
      showMainWindowWhenReady();
    }
  });

  app.whenReady().then(async () => {
    const data = await store.getData();
    lastDisplayMode = data.settings.lastDisplayMode;
    await applyLoginItemSettings(data.settings);
    Menu.setApplicationMenu(null);
    createTray();
    registerIpc();

    scheduler = new ReminderScheduler(store, showAlert);
    desktopWebServer = await startDesktopWebServer({
      store,
      staticRoot: join(__dirname, "..", "..", "dist"),
      getScheduler: () => scheduler ?? null,
      broadcastDataChanged
    });
    scheduler.start();

    const hiddenByArgument = process.argv.includes("--hidden");
    await createMainWindow(hiddenByArgument && data.settings.lastDisplayMode === "tray");
    if (pendingSecondInstanceShow) {
      pendingSecondInstanceShow = false;
      showMainWindow();
    }
  });

  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    quitting = true;
    singleInstanceServer?.close();
    singleInstanceServer = null;
    desktopWebServer?.close();
    desktopWebServer = null;
    scheduler?.stop();
  });

  app.on("activate", () => {
    showMainWindow();
  });
}

void acquireRuntimeLock().then((hasRuntimeLock) => {
  if (!hasRuntimeLock) {
    app.exit(0);
    return;
  }

  if (!app.requestSingleInstanceLock()) {
    void notifyExistingInstance().finally(() => app.exit(0));
    return;
  }

  registerAppLifecycle();
});
