import { describe, expect, it } from "vitest";
import { isChinaWorkday } from "../src/shared/holidays";
import { getDueAlerts } from "../src/shared/scheduler";
import { defaultHolidayPolicy, defaultRecurrenceRule, defaultSettings, ReminderItem } from "../src/shared/types";

function makeReminder(overrides: Partial<ReminderItem> = {}): ReminderItem {
  const now = new Date("2026-05-30T00:00:00.000Z").toISOString();
  return {
    id: "reminder-1",
    title: "会议",
    description: "",
    startAt: "2026-05-30T10:00:00.000Z",
    leadMinutes: [5, 15],
    recurrenceRule: defaultRecurrenceRule(),
    holidayPolicy: defaultHolidayPolicy(),
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("China holiday calendar", () => {
  it("uses 2026 official holiday and adjusted workday data", () => {
    expect(isChinaWorkday(new Date("2026-01-01T10:00:00"))).toBe(false);
    expect(isChinaWorkday(new Date("2026-01-04T10:00:00"))).toBe(true);
    expect(isChinaWorkday(new Date("2026-02-14T10:00:00"))).toBe(true);
  });
});

describe("reminder scheduling", () => {
  it("creates one alert per selected lead time", () => {
    const settings = defaultSettings();
    const due = getDueAlerts(
      [makeReminder()],
      {},
      settings,
      new Date("2026-05-30T09:55:00.000Z"),
      new Date("2026-05-30T09:40:00.000Z")
    );

    expect(due.map((alert) => alert.leadMinutes)).toEqual([15, 5]);
  });

  it("skips holidays when the reminder is workday only", () => {
    const settings = defaultSettings();
    const due = getDueAlerts(
      [
        makeReminder({
          startAt: "2026-01-01T10:00:00.000Z",
          leadMinutes: [5],
          holidayPolicy: {
            workdayOnly: true,
            useChinaHolidays: true
          }
        })
      ],
      {},
      settings,
      new Date("2026-01-01T09:55:00.000Z"),
      new Date("2026-01-01T09:50:00.000Z")
    );

    expect(due).toHaveLength(0);
  });
});
