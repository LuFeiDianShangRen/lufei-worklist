import { HolidayOverrides } from "./types";
import { addDays, toDateKey } from "./date";

export const CHINA_2026_HOLIDAY_SOURCE =
  "https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html";

function expandRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);

  while (current <= last) {
    dates.push(toDateKey(current));
    current = addDays(current, 1);
  }

  return dates;
}

const holidayDates = [
  ...expandRange("2026-01-01", "2026-01-03"),
  ...expandRange("2026-02-15", "2026-02-23"),
  ...expandRange("2026-04-04", "2026-04-06"),
  ...expandRange("2026-05-01", "2026-05-05"),
  ...expandRange("2026-06-19", "2026-06-21"),
  ...expandRange("2026-09-25", "2026-09-27"),
  ...expandRange("2026-10-01", "2026-10-07")
];

const adjustedWorkdays = ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"];

export const CHINA_2026_HOLIDAYS = {
  holidays: new Set(holidayDates),
  workdays: new Set(adjustedWorkdays)
};

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isChinaWorkday(date: Date, overrides?: HolidayOverrides): boolean {
  const key = toDateKey(date);

  if (overrides?.workdays.includes(key)) {
    return true;
  }

  if (overrides?.holidays.includes(key)) {
    return false;
  }

  if (CHINA_2026_HOLIDAYS.workdays.has(key)) {
    return true;
  }

  if (CHINA_2026_HOLIDAYS.holidays.has(key)) {
    return false;
  }

  return !isWeekend(date);
}

export function isPlainWorkday(date: Date): boolean {
  return !isWeekend(date);
}
