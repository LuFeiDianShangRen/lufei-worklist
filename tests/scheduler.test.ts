import { describe, expect, it } from "vitest";
import { isChinaWorkday } from "../src/shared/holidays";
import { buildAlertKey, getDueAlerts, getNextOccurrenceAfter, getUnconfirmedAlerts } from "../src/shared/scheduler";
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

  it("does not schedule completed reminders", () => {
    const settings = defaultSettings();
    const due = getDueAlerts(
      [makeReminder({ completedAt: "2026-06-02T08:00:00.000Z" })],
      {},
      settings,
      new Date("2026-05-30T09:55:00.000Z"),
      new Date("2026-05-30T09:40:00.000Z")
    );

    expect(due).toHaveLength(0);
  });

  it("does not schedule in-progress reminders until their thirty minute snooze expires", () => {
    const settings = defaultSettings();
    const item = makeReminder({
      progressStatus: "inProgress",
      progressSnoozedUntil: "2026-05-30T10:25:00.000Z"
    });

    expect(
      getDueAlerts(
        [item],
        {},
        settings,
        new Date("2026-05-30T09:55:00.000Z"),
        new Date("2026-05-30T09:40:00.000Z")
      )
    ).toHaveLength(0);

    expect(
      getUnconfirmedAlerts(
        [item],
        {
          [buildAlertKey(item.id, item.startAt, 5)]: {
            key: buildAlertKey(item.id, item.startAt, 5),
            itemId: item.id,
            occurrenceAt: item.startAt,
            remindAt: "2026-05-30T09:55:00.000Z",
            leadMinutes: 5,
            triggeredAt: "2026-05-30T09:55:00.000Z",
            lastShownAt: "2026-05-30T09:55:00.000Z",
            confirmedAt: null
          }
        },
        new Date("2026-05-30T10:24:59.000Z")
      )
    ).toHaveLength(0);

    expect(
      getUnconfirmedAlerts(
        [item],
        {
          [buildAlertKey(item.id, item.startAt, 5)]: {
            key: buildAlertKey(item.id, item.startAt, 5),
            itemId: item.id,
            occurrenceAt: item.startAt,
            remindAt: "2026-05-30T09:55:00.000Z",
            leadMinutes: 5,
            triggeredAt: "2026-05-30T09:55:00.000Z",
            lastShownAt: "2026-05-30T09:55:00.000Z",
            confirmedAt: null
          }
        },
        new Date("2026-05-30T10:25:01.000Z")
      )
    ).toHaveLength(1);
  });

  it("finds the next occurrence for a completed daily reminder", () => {
    const item = makeReminder({
      startAt: "2026-06-02T10:00:00.000Z",
      recurrenceRule: {
        ...defaultRecurrenceRule(),
        frequency: "daily"
      }
    });

    expect(getNextOccurrenceAfter(item, new Date("2026-06-02T10:00:00.000Z"), defaultSettings())?.toISOString()).toBe(
      "2026-06-03T10:00:00.000Z"
    );
  });

  it("does not repeat unconfirmed alerts for completed reminders", () => {
    const item = makeReminder({ completedAt: "2026-06-02T08:00:00.000Z" });
    const occurrenceAt = "2026-05-30T10:00:00.000Z";
    const key = buildAlertKey(item.id, occurrenceAt, 5);
    const alerts = getUnconfirmedAlerts([item], {
      [key]: {
        key,
        itemId: item.id,
        occurrenceAt,
        remindAt: "2026-05-30T09:55:00.000Z",
        leadMinutes: 5,
        triggeredAt: "2026-05-30T09:55:00.000Z",
        lastShownAt: "2026-05-30T09:55:00.000Z",
        confirmedAt: null
      }
    });

    expect(alerts).toHaveLength(0);
  });

  it("does not repeat old unconfirmed alerts after a recurring reminder advances", () => {
    const item = makeReminder({
      startAt: "2026-06-03T10:00:00.000Z",
      recurrenceRule: {
        ...defaultRecurrenceRule(),
        frequency: "daily"
      }
    });
    const occurrenceAt = "2026-06-02T10:00:00.000Z";
    const key = buildAlertKey(item.id, occurrenceAt, 5);
    const alerts = getUnconfirmedAlerts([item], {
      [key]: {
        key,
        itemId: item.id,
        occurrenceAt,
        remindAt: "2026-06-02T09:55:00.000Z",
        leadMinutes: 5,
        triggeredAt: "2026-06-02T09:55:00.000Z",
        lastShownAt: "2026-06-02T09:55:00.000Z",
        confirmedAt: null
      }
    });

    expect(alerts).toHaveLength(0);
  });

  it("snoozes acknowledged alerts for ten minutes only", () => {
    const item = makeReminder();
    const occurrenceAt = "2026-05-30T10:00:00.000Z";
    const key = buildAlertKey(item.id, occurrenceAt, 5);
    const baseAlert = {
      key,
      itemId: item.id,
      occurrenceAt,
      remindAt: "2026-05-30T09:55:00.000Z",
      leadMinutes: 5 as const,
      triggeredAt: "2026-05-30T09:55:00.000Z",
      lastShownAt: "2026-05-30T09:56:00.000Z",
      confirmedAt: null
    };

    expect(
      getUnconfirmedAlerts(
        [item],
        {
          [key]: {
            ...baseAlert,
            snoozedUntil: "2026-05-30T10:06:00.000Z"
          }
        },
        new Date("2026-05-30T10:05:59.000Z")
      )
    ).toHaveLength(0);

    expect(
      getUnconfirmedAlerts(
        [item],
        {
          [key]: {
            ...baseAlert,
            snoozedUntil: "2026-05-30T10:06:00.000Z"
          }
        },
        new Date("2026-05-30T10:06:01.000Z")
      )
    ).toHaveLength(1);
  });

  it("treats old confirmed alerts as a ten minute snooze", () => {
    const item = makeReminder();
    const occurrenceAt = "2026-05-30T10:00:00.000Z";
    const key = buildAlertKey(item.id, occurrenceAt, 5);
    const alert = {
      key,
      itemId: item.id,
      occurrenceAt,
      remindAt: "2026-05-30T09:55:00.000Z",
      leadMinutes: 5 as const,
      triggeredAt: "2026-05-30T09:55:00.000Z",
      lastShownAt: "2026-05-30T09:56:00.000Z",
      confirmedAt: "2026-05-30T09:56:00.000Z"
    };

    expect(getUnconfirmedAlerts([item], { [key]: alert }, new Date("2026-05-30T10:05:00.000Z"))).toHaveLength(0);
    expect(getUnconfirmedAlerts([item], { [key]: alert }, new Date("2026-05-30T10:06:01.000Z"))).toHaveLength(1);
  });
});
