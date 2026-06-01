import { contextBridge, ipcRenderer } from "electron";
import { AlertOccurrence, AppData, AppSettings, ReminderItem } from "../shared/types";

const api = {
  getData: (): Promise<AppData> => ipcRenderer.invoke("app-data:get"),
  saveReminder: (item: ReminderItem): Promise<AppData> => ipcRenderer.invoke("reminder:save", item),
  deleteReminder: (id: string): Promise<AppData> => ipcRenderer.invoke("reminder:delete", id),
  saveSettings: (settings: AppSettings): Promise<AppData> => ipcRenderer.invoke("settings:save", settings),
  exportBackup: (): Promise<{ canceled: boolean; filePath?: string }> => ipcRenderer.invoke("backup:export"),
  importBackup: (): Promise<{ canceled: boolean; imported?: number; conflicts?: number; overwrite?: boolean }> =>
    ipcRenderer.invoke("backup:import"),
  acknowledgeAlert: (key: string): Promise<void> => ipcRenderer.invoke("alert:acknowledge", key),
  performMenuAction: (action: string): Promise<void> => ipcRenderer.invoke("menu:action", action),
  onDataChanged: (callback: (data: AppData) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AppData) => callback(data);
    ipcRenderer.on("app-data:changed", listener);
    return () => ipcRenderer.off("app-data:changed", listener);
  },
  onFocusReminder: (callback: (id: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on("reminder:focus", listener);
    return () => ipcRenderer.off("reminder:focus", listener);
  },
  onOverlayAlert: (callback: (alert: AlertOccurrence) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, alert: AlertOccurrence) => callback(alert);
    ipcRenderer.on("overlay:alert", listener);
    return () => ipcRenderer.off("overlay:alert", listener);
  },
  acknowledgeOverlay: (key: string): void => ipcRenderer.send("overlay:acknowledge", key)
};

contextBridge.exposeInMainWorld("reminderApi", api);

export type ReminderApi = typeof api;
