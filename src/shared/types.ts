export const LEAD_MINUTES = [5, 10, 15, 20, 25, 30, 60, 120] as const;

export type LeadMinutes = (typeof LEAD_MINUTES)[number];
export type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type ReminderProgressStatus = "todo" | "inProgress";
export type StartupDisplayMode = "visible" | "tray";
export type TickTickService = "dida365" | "ticktick";

export interface HolidayOverrides {
  holidays: string[];
  workdays: string[];
}

export interface HolidayPolicy {
  workdayOnly: boolean;
  useChinaHolidays: boolean;
}

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDays: number[];
  months: number[];
  endDate: string | null;
  count: number | null;
}

export interface ReminderItem {
  id: string;
  title: string;
  description: string;
  startAt: string;
  leadMinutes: LeadMinutes[];
  recurrenceRule: RecurrenceRule;
  holidayPolicy: HolidayPolicy;
  enabled: boolean;
  completedAt?: string | null;
  progressStatus?: ReminderProgressStatus;
  progressSnoozedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRecord {
  key: string;
  itemId: string;
  occurrenceAt: string;
  remindAt: string;
  leadMinutes: LeadMinutes;
  triggeredAt: string;
  lastShownAt: string | null;
  confirmedAt: string | null;
  snoozedUntil?: string | null;
}

export interface AppSettings {
  startAtLogin: boolean;
  lastDisplayMode: StartupDisplayMode;
  soundEnabled: boolean;
  defaultLeadMinutes: LeadMinutes[];
  overlayRepeatSeconds: number;
  holidayOverrides: HolidayOverrides;
  lastSchedulerCheckAt: string | null;
  tickTickSync: TickTickSyncSettings;
}

export interface TickTickSyncSettings {
  service: TickTickService;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  lastSyncAt: string | null;
}

export interface TickTickSyncResult {
  data: AppData;
  imported: number;
  updated: number;
  skipped: number;
  projects: number;
}

export interface AppData {
  version: 1;
  reminders: ReminderItem[];
  alerts: Record<string, AlertRecord>;
  settings: AppSettings;
}

export interface AlertOccurrence {
  key: string;
  itemId: string;
  title: string;
  description: string;
  occurrenceAt: string;
  remindAt: string;
  leadMinutes: LeadMinutes;
}

export interface ReminderBackup {
  version: "reminder-backup-v1";
  exportedAt: string;
  items: ReminderItem[];
  settings: AppSettings;
  alerts: Record<string, AlertRecord>;
  holidayOverrides: HolidayOverrides;
}

export const defaultRecurrenceRule = (): RecurrenceRule => ({
  frequency: "none",
  interval: 1,
  weekdays: [],
  monthDays: [],
  months: [],
  endDate: null,
  count: null
});

export const defaultHolidayPolicy = (): HolidayPolicy => ({
  workdayOnly: false,
  useChinaHolidays: true
});

export const defaultSettings = (): AppSettings => ({
  startAtLogin: false,
  lastDisplayMode: "visible",
  soundEnabled: true,
  defaultLeadMinutes: [15],
  overlayRepeatSeconds: 60,
  holidayOverrides: {
    holidays: [],
    workdays: []
  },
  lastSchedulerCheckAt: null,
  tickTickSync: defaultTickTickSyncSettings()
});

export const defaultTickTickSyncSettings = (): TickTickSyncSettings => ({
  service: "dida365",
  clientId: "",
  clientSecret: "",
  redirectUri: "http://127.0.0.1:38176/ticktick/callback",
  accessToken: "",
  lastSyncAt: null
});
