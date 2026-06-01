import { AppData, ReminderBackup } from "./types";

export const BACKUP_VERSION = "reminder-backup-v1";

export function createBackup(data: AppData): ReminderBackup {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    items: data.reminders,
    settings: data.settings,
    alerts: data.alerts,
    holidayOverrides: data.settings.holidayOverrides
  };
}

export function parseBackup(value: unknown): ReminderBackup {
  if (!value || typeof value !== "object") {
    throw new Error("备份文件格式无效。");
  }

  const backup = value as Partial<ReminderBackup>;
  if (backup.version !== BACKUP_VERSION) {
    throw new Error("备份文件版本不受支持。");
  }

  if (!Array.isArray(backup.items) || !backup.settings || typeof backup.alerts !== "object") {
    throw new Error("备份文件内容不完整。");
  }

  return backup as ReminderBackup;
}

export function mergeBackup(current: AppData, backup: ReminderBackup, overwriteConflicts: boolean): AppData {
  const byId = new Map(current.reminders.map((item) => [item.id, item]));

  for (const item of backup.items) {
    if (!byId.has(item.id) || overwriteConflicts) {
      byId.set(item.id, item);
    }
  }

  return {
    version: 1,
    reminders: Array.from(byId.values()),
    alerts: overwriteConflicts ? { ...current.alerts, ...backup.alerts } : { ...backup.alerts, ...current.alerts },
    settings: {
      ...current.settings,
      ...backup.settings,
      holidayOverrides: backup.holidayOverrides ?? backup.settings.holidayOverrides
    }
  };
}
