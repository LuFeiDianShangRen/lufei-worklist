import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildAlertKey,
  getAcknowledgeSnoozeMinutes,
  getNextOccurrenceAfter,
  IN_PROGRESS_SNOOZE_MINUTES,
  isInProgressReminder,
  isRecurringReminder
} from "../shared/scheduler";
import {
  AlertOccurrence,
  AlertRecord,
  AppData,
  AppSettings,
  defaultSettings,
  ReminderItem
} from "../shared/types";

export class ReminderStore {
  private readonly filePath: string;
  private data: AppData | null = null;

  constructor(filePath = join(app.getPath("userData"), "reminders.json")) {
    this.filePath = filePath;
  }

  async load(): Promise<AppData> {
    if (this.data) {
      return this.data;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = this.normalize(JSON.parse(raw));
    } catch {
      this.data = {
        version: 1,
        reminders: [],
        alerts: {},
        settings: defaultSettings()
      };
      await this.save();
    }

    return this.data;
  }

  async replace(data: AppData): Promise<AppData> {
    this.data = this.normalize(data);
    await this.save();
    return this.data;
  }

  async getData(): Promise<AppData> {
    return this.load();
  }

  async upsertReminder(item: ReminderItem): Promise<AppData> {
    const data = await this.load();
    const now = new Date().toISOString();
    const index = data.reminders.findIndex((existing) => existing.id === item.id);
    const nextItem = this.normalizeProgressFields({ ...item, updatedAt: now });
    this.ensureInProgressAlert(data, nextItem, now);

    if (index >= 0) {
      data.reminders[index] = nextItem;
    } else {
      data.reminders.push(nextItem);
    }

    await this.save();
    return data;
  }

  async upsertReminders(items: ReminderItem[]): Promise<{ data: AppData; imported: number; updated: number }> {
    const data = await this.load();
    let imported = 0;
    let updated = 0;

    for (const item of items) {
      const now = new Date().toISOString();
      const index = data.reminders.findIndex((existing) => existing.id === item.id);
      const nextItem = this.normalizeProgressFields({ ...item, updatedAt: now });
      this.ensureInProgressAlert(data, nextItem, now);

      if (index >= 0) {
        data.reminders[index] = nextItem;
        updated += 1;
      } else {
        data.reminders.push(nextItem);
        imported += 1;
      }
    }

    await this.save();
    return { data, imported, updated };
  }

  async deleteReminder(id: string): Promise<AppData> {
    const data = await this.load();
    data.reminders = data.reminders.filter((item) => item.id !== id);

    for (const key of Object.keys(data.alerts)) {
      if (data.alerts[key].itemId === id) {
        delete data.alerts[key];
      }
    }

    await this.save();
    return data;
  }

  async updateSettings(settings: AppSettings): Promise<AppData> {
    const data = await this.load();
    data.settings = {
      ...data.settings,
      ...settings
    };
    await this.save();
    return data;
  }

  async markAlertShown(alert: AlertOccurrence): Promise<AppData> {
    const data = await this.load();
    const now = new Date().toISOString();
    const existing = data.alerts[alert.key];

    data.alerts[alert.key] = {
      key: alert.key,
      itemId: alert.itemId,
      occurrenceAt: alert.occurrenceAt,
      remindAt: alert.remindAt,
      leadMinutes: alert.leadMinutes,
      triggeredAt: existing?.triggeredAt ?? now,
      lastShownAt: now,
      confirmedAt: existing?.confirmedAt ?? null,
      snoozedUntil:
        existing?.snoozedUntil && new Date(existing.snoozedUntil).getTime() > Date.now()
          ? existing.snoozedUntil
          : null
    };

    await this.save();
    return data;
  }

  async acknowledgeAlert(key: string): Promise<AlertRecord | null> {
    const data = await this.load();
    const existing = data.alerts[key];

    if (!existing) {
      return null;
    }

    const item = data.reminders.find((reminder) => reminder.id === existing.itemId);
    const now = new Date();
    const snoozeMinutes = getAcknowledgeSnoozeMinutes(item);
    const snoozedUntil = new Date(now.getTime() + snoozeMinutes * 60 * 1_000).toISOString();

    existing.lastShownAt = now.toISOString();
    existing.confirmedAt = null;
    existing.snoozedUntil = snoozedUntil;

    if (isInProgressReminder(item)) {
      item.progressSnoozedUntil = snoozedUntil;
      item.updatedAt = now.toISOString();
    }

    await this.save();
    return existing;
  }

  async setLastSchedulerCheck(value: string): Promise<void> {
    const data = await this.load();
    data.settings.lastSchedulerCheckAt = value;
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.data) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }

  private normalize(value: Partial<AppData>): AppData {
    const settings = {
      ...defaultSettings(),
      ...value.settings,
      holidayOverrides: {
        ...defaultSettings().holidayOverrides,
        ...value.settings?.holidayOverrides
      },
      tickTickSync: {
        ...defaultSettings().tickTickSync,
        ...value.settings?.tickTickSync
      }
    };

    const reminders = Array.isArray(value.reminders) ? value.reminders : [];

    return {
      version: 1,
      reminders: reminders.map((item) => this.normalizeReminder(item, settings)),
      alerts: value.alerts ?? {},
      settings
    };
  }

  private normalizeProgressFields(item: ReminderItem): ReminderItem {
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

  private ensureInProgressAlert(data: AppData, item: ReminderItem, nowIso: string): void {
    if (!isInProgressReminder(item)) {
      return;
    }

    const now = new Date(nowIso);
    const snoozedUntil =
      item.progressSnoozedUntil && new Date(item.progressSnoozedUntil).getTime() > now.getTime()
        ? item.progressSnoozedUntil
        : new Date(now.getTime() + IN_PROGRESS_SNOOZE_MINUTES * 60 * 1_000).toISOString();
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

  private normalizeReminder(item: ReminderItem, settings: AppSettings): ReminderItem {
    const normalizedItem = this.normalizeProgressFields(item);

    if (!normalizedItem.completedAt || !isRecurringReminder(normalizedItem)) {
      return normalizedItem;
    }

    const completedAt = new Date(normalizedItem.completedAt).getTime();
    const startAt = new Date(item.startAt).getTime();
    const after = new Date(Math.max(completedAt, startAt));
    const nextOccurrence = getNextOccurrenceAfter(
      {
        ...normalizedItem,
        completedAt: null,
        enabled: true,
        progressStatus: "todo",
        progressSnoozedUntil: null
      },
      after,
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
}
