import {
  AlertOccurrence,
  AlertRecord,
  AppSettings,
  LeadMinutes,
  LEAD_MINUTES,
  ReminderItem
} from "./types";
import {
  addDays,
  addMonths,
  addYears,
  copyTime,
  dateExists,
  diffCalendarDays,
  diffCalendarMonths,
  endOfLocalDay,
  MINUTE_MS,
  startOfLocalDay
} from "./date";
import { isChinaWorkday, isPlainWorkday } from "./holidays";

const MAX_ENUMERATED_OCCURRENCES = 3_000;

export function buildAlertKey(itemId: string, occurrenceAt: string, leadMinutes: LeadMinutes): string {
  return `${itemId}|${occurrenceAt}|${leadMinutes}`;
}

export function enumerateOccurrences(item: ReminderItem, from: Date, to: Date, settings: AppSettings): Date[] {
  if (!item.enabled || to < from) {
    return [];
  }

  const start = new Date(item.startAt);
  const interval = Math.max(1, item.recurrenceRule.interval || 1);
  const end = item.recurrenceRule.endDate
    ? endOfLocalDay(new Date(`${item.recurrenceRule.endDate}T00:00:00`))
    : null;
  const limit = item.recurrenceRule.count;
  const occurrences: Date[] = [];

  const shouldInclude = (candidate: Date): boolean => {
    if (candidate < start) {
      return false;
    }
    if (end && candidate > end) {
      return false;
    }
    if (item.holidayPolicy.workdayOnly) {
      const isWorkday = item.holidayPolicy.useChinaHolidays
        ? isChinaWorkday(candidate, settings.holidayOverrides)
        : isPlainWorkday(candidate);
      if (!isWorkday) {
        return false;
      }
    }
    return true;
  };

  const pushCandidate = (candidate: Date): boolean => {
    if (!shouldInclude(candidate)) {
      return false;
    }

    if (limit && occurrences.length >= limit) {
      return true;
    }

    if (candidate >= from && candidate <= to) {
      occurrences.push(candidate);
    }

    return limit ? occurrences.length >= limit : false;
  };

  const frequency = item.recurrenceRule.frequency;

  if (frequency === "none") {
    pushCandidate(start);
    return occurrences;
  }

  if (frequency === "daily") {
    const firstOffset = Math.max(0, Math.floor(diffCalendarDays(start, from) / interval) * interval - interval);
    let cursor = addDays(start, firstOffset);

    for (let guard = 0; guard < MAX_ENUMERATED_OCCURRENCES && cursor <= to; guard += 1) {
      if (pushCandidate(cursor)) {
        break;
      }
      cursor = addDays(cursor, interval);
    }
  }

  if (frequency === "weekly") {
    const selectedWeekdays = item.recurrenceRule.weekdays.length
      ? item.recurrenceRule.weekdays
      : [start.getDay()];
    let cursor = startOfLocalDay(from < start ? start : from);
    cursor = addDays(cursor, -7);

    for (let guard = 0; guard < MAX_ENUMERATED_OCCURRENCES && cursor <= to; guard += 1) {
      const weekIndex = Math.floor(diffCalendarDays(start, cursor) / 7);
      const candidate = copyTime(cursor, start);

      if (weekIndex >= 0 && weekIndex % interval === 0 && selectedWeekdays.includes(candidate.getDay())) {
        if (pushCandidate(candidate)) {
          break;
        }
      }

      cursor = addDays(cursor, 1);
    }
  }

  if (frequency === "monthly") {
    const selectedDays = item.recurrenceRule.monthDays.length ? item.recurrenceRule.monthDays : [start.getDate()];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const monthOffset = Math.max(0, diffCalendarMonths(cursor, from) - interval);
    cursor = addMonths(cursor, monthOffset);

    for (let guard = 0; guard < MAX_ENUMERATED_OCCURRENCES && cursor <= to; guard += 1) {
      const monthIndex = diffCalendarMonths(start, cursor);
      if (monthIndex >= 0 && monthIndex % interval === 0) {
        for (const day of selectedDays) {
          if (dateExists(cursor.getFullYear(), cursor.getMonth(), day)) {
            const candidate = copyTime(new Date(cursor.getFullYear(), cursor.getMonth(), day), start);
            if (pushCandidate(candidate)) {
              return occurrences;
            }
          }
        }
      }
      cursor = addMonths(cursor, 1);
    }
  }

  if (frequency === "yearly") {
    const selectedMonths = item.recurrenceRule.months.length ? item.recurrenceRule.months : [start.getMonth() + 1];
    const selectedDays = item.recurrenceRule.monthDays.length ? item.recurrenceRule.monthDays : [start.getDate()];
    let cursor = new Date(start.getFullYear(), 0, 1);

    while (cursor < from) {
      cursor = addYears(cursor, 1);
    }
    cursor = addYears(cursor, -1);

    for (let guard = 0; guard < MAX_ENUMERATED_OCCURRENCES && cursor <= to; guard += 1) {
      const yearIndex = cursor.getFullYear() - start.getFullYear();
      if (yearIndex >= 0 && yearIndex % interval === 0) {
        for (const month of selectedMonths) {
          for (const day of selectedDays) {
            const monthIndex = month - 1;
            if (dateExists(cursor.getFullYear(), monthIndex, day)) {
              const candidate = copyTime(new Date(cursor.getFullYear(), monthIndex, day), start);
              if (pushCandidate(candidate)) {
                return occurrences;
              }
            }
          }
        }
      }
      cursor = addYears(cursor, 1);
    }
  }

  return occurrences.sort((left, right) => left.getTime() - right.getTime());
}

export function getDueAlerts(
  reminders: ReminderItem[],
  alerts: Record<string, AlertRecord>,
  settings: AppSettings,
  now: Date,
  windowStart: Date
): AlertOccurrence[] {
  const maxLead = Math.max(...LEAD_MINUTES);
  const occurrenceEnd = new Date(now.getTime() + maxLead * MINUTE_MS);
  const due: AlertOccurrence[] = [];

  for (const item of reminders) {
    const occurrences = enumerateOccurrences(item, windowStart, occurrenceEnd, settings);

    for (const occurrence of occurrences) {
      for (const lead of item.leadMinutes) {
        const remindAt = new Date(occurrence.getTime() - lead * MINUTE_MS);
        if (remindAt < windowStart || remindAt > now) {
          continue;
        }

        const occurrenceIso = occurrence.toISOString();
        const key = buildAlertKey(item.id, occurrenceIso, lead);
        if (alerts[key]?.confirmedAt) {
          continue;
        }

        due.push({
          key,
          itemId: item.id,
          title: item.title,
          description: item.description,
          occurrenceAt: occurrenceIso,
          remindAt: remindAt.toISOString(),
          leadMinutes: lead
        });
      }
    }
  }

  return due.sort((left, right) => new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime());
}

export function getUnconfirmedAlerts(reminders: ReminderItem[], alerts: Record<string, AlertRecord>): AlertOccurrence[] {
  const reminderMap = new Map(reminders.map((item) => [item.id, item]));

  return Object.values(alerts)
    .filter((alert) => !alert.confirmedAt)
    .map((alert) => {
      const item = reminderMap.get(alert.itemId);
      return {
        key: alert.key,
        itemId: alert.itemId,
        title: item?.title ?? "提醒",
        description: item?.description ?? "",
        occurrenceAt: alert.occurrenceAt,
        remindAt: alert.remindAt,
        leadMinutes: alert.leadMinutes
      };
    });
}
