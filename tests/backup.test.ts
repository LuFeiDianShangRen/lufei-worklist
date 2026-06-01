import { describe, expect, it } from "vitest";
import { createBackup, mergeBackup, parseBackup } from "../src/shared/backup";
import { AppData, defaultHolidayPolicy, defaultRecurrenceRule, defaultSettings, ReminderItem } from "../src/shared/types";

function item(id: string, title: string): ReminderItem {
  const now = new Date("2026-05-30T00:00:00.000Z").toISOString();
  return {
    id,
    title,
    description: "",
    startAt: "2026-05-30T10:00:00.000Z",
    leadMinutes: [15],
    recurrenceRule: defaultRecurrenceRule(),
    holidayPolicy: defaultHolidayPolicy(),
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

function data(reminders: ReminderItem[]): AppData {
  return {
    version: 1,
    reminders,
    alerts: {},
    settings: defaultSettings()
  };
}

describe("backup import/export", () => {
  it("exports and parses versioned backups", () => {
    const backup = createBackup(data([item("a", "会议")]));
    expect(parseBackup(backup).version).toBe("reminder-backup-v1");
  });

  it("keeps local conflict when overwrite is false", () => {
    const current = data([item("a", "本机")]);
    const backup = createBackup(data([item("a", "备份"), item("b", "新增")]));
    const merged = mergeBackup(current, backup, false);

    expect(merged.reminders.find((entry) => entry.id === "a")?.title).toBe("本机");
    expect(merged.reminders.find((entry) => entry.id === "b")?.title).toBe("新增");
  });
});
