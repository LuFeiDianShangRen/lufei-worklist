import {
  CalendarClock,
  Check,
  Clock3,
  Download,
  History,
  Inbox,
  ListChecks,
  ListTodo,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Save,
  Settings,
  Square,
  SquareCheck,
  Trash2,
  Upload,
  Volume2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toDateKey } from "../shared/date";
import { getNextOccurrenceAfter, IN_PROGRESS_SNOOZE_MINUTES, isRecurringReminder } from "../shared/scheduler";
import {
  AppData,
  AppSettings,
  defaultHolidayPolicy,
  defaultRecurrenceRule,
  defaultSettings,
  LEAD_MINUTES,
  LeadMinutes,
  ReminderItem
} from "../shared/types";

type ViewKey = "all" | "today" | "previous" | "future" | "inProgress" | "completed" | "disabled";

const menuGroups = [
  {
    key: "file",
    label: "文件",
    items: [
      { label: "打开主窗口", action: "file-open" },
      { label: "打开网页版", action: "file-web" },
      { label: "关于路飞清单", action: "file-about" },
      { label: "退出", action: "file-exit", separatorBefore: true }
    ]
  },
  {
    key: "edit",
    label: "编辑",
    items: [
      { label: "撤销", action: "edit-undo", shortcut: "Ctrl+Z" },
      { label: "重做", action: "edit-redo", shortcut: "Ctrl+Y" },
      { label: "剪切", action: "edit-cut", shortcut: "Ctrl+X", separatorBefore: true },
      { label: "复制", action: "edit-copy", shortcut: "Ctrl+C" },
      { label: "粘贴", action: "edit-paste", shortcut: "Ctrl+V" },
      { label: "删除", action: "edit-delete" },
      { label: "全选", action: "edit-select-all", shortcut: "Ctrl+A", separatorBefore: true }
    ]
  },
  {
    key: "view",
    label: "视窗",
    items: [
      { label: "重新加载", action: "view-reload", shortcut: "Ctrl+R" },
      { label: "强制重新加载", action: "view-force-reload", shortcut: "Ctrl+Shift+R" },
      { label: "实际大小", action: "view-reset-zoom", shortcut: "Ctrl+0", separatorBefore: true },
      { label: "放大", action: "view-zoom-in", shortcut: "Ctrl+=" },
      { label: "缩小", action: "view-zoom-out", shortcut: "Ctrl+-" },
      { label: "切换全屏", action: "view-toggle-fullscreen", shortcut: "F11", separatorBefore: true }
    ]
  },
  {
    key: "window",
    label: "窗口",
    items: [
      { label: "最小化", action: "window-minimize" },
      { label: "关闭窗口", action: "window-close" },
      { label: "打开主窗口", action: "window-open", separatorBefore: true }
    ]
  }
] as const;

const weekdays = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" }
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5);

const emptyData: AppData = {
  version: 1,
  reminders: [],
  alerts: {},
  settings: defaultSettings()
};

function nextHourIso(): string {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

function newReminder(settings: AppSettings): ReminderItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新提醒",
    description: "",
    startAt: nextHourIso(),
    leadMinutes: settings.defaultLeadMinutes,
    recurrenceRule: defaultRecurrenceRule(),
    holidayPolicy: defaultHolidayPolicy(),
    enabled: true,
    completedAt: null,
    progressStatus: "todo",
    progressSnoozedUntil: null,
    createdAt: now,
    updatedAt: now
  };
}

function parseNumberList(value: string, min: number, max: number): number[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((number) => Number.isInteger(number) && number >= min && number <= max)
    )
  ).sort((left, right) => left - right);
}

function formatNumberList(value: number[]): string {
  return value.join(", ");
}

function isToday(value: string): boolean {
  return toDateKey(new Date(value)) === toDateKey(new Date());
}

function isBeforeToday(value: string): boolean {
  return toDateKey(new Date(value)) < toDateKey(new Date());
}

function isFuture(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}

function isCompleted(item: ReminderItem): boolean {
  return Boolean(item.completedAt);
}

function isInProgress(item: ReminderItem): boolean {
  return !isCompleted(item) && item.progressStatus === "inProgress";
}

function inProgressSnoozedUntil(): string {
  return new Date(Date.now() + IN_PROGRESS_SNOOZE_MINUTES * 60 * 1_000).toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function roundedFiveMinuteDate(value: Date): Date {
  const date = new Date(value);
  const roundedMinute = Math.round(date.getMinutes() / 5) * 5;
  date.setSeconds(0, 0);
  if (roundedMinute === 60) {
    date.setHours(date.getHours() + 1, 0, 0, 0);
  } else {
    date.setMinutes(roundedMinute, 0, 0);
  }
  return date;
}

function currentMinuteIso(): string {
  return roundedFiveMinuteDate(new Date()).toISOString();
}

function dateInputValue(value: string): string {
  return toDateKey(new Date(value));
}

function roundedMinuteValue(value: string): number {
  return roundedFiveMinuteDate(new Date(value)).getMinutes();
}

function hourValue(value: string): number {
  return roundedFiveMinuteDate(new Date(value)).getHours();
}

function composeTimeIso(dateKey: string, hour: number, minute: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function updateDatePart(value: string, dateKey: string): string {
  const date = roundedFiveMinuteDate(new Date(value));
  return composeTimeIso(dateKey, date.getHours(), date.getMinutes());
}

function updateHourPart(value: string, hour: number): string {
  const date = roundedFiveMinuteDate(new Date(value));
  return composeTimeIso(toDateKey(date), hour, date.getMinutes());
}

function updateMinutePart(value: string, minute: number): string {
  const date = roundedFiveMinuteDate(new Date(value));
  return composeTimeIso(toDateKey(date), date.getHours(), minute);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App(): JSX.Element {
  const [data, setData] = useState<AppData>(emptyData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReminderItem | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("all");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tickTickModalOpen, setTickTickModalOpen] = useState(false);
  const [statusMenuId, setStatusMenuId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [tickTickDraft, setTickTickDraft] = useState(defaultSettings().tickTickSync);

  useEffect(() => {
    void window.reminderApi.getData().then((loaded) => {
      setData(loaded);
      const first = loaded.reminders[0] ?? null;
      if (first) {
        setSelectedId(first.id);
        setDraft(first);
      }
    });

    const offData = window.reminderApi.onDataChanged((next) => {
      setData(next);
      setDraft((current) => (current ? next.reminders.find((item) => item.id === current.id) ?? current : current));
    });
    const offFocus = window.reminderApi.onFocusReminder((id) => {
      void window.reminderApi.getData().then((latest) => {
        setData(latest);
        setSelectedId(id);
        const item = latest.reminders.find((reminder) => reminder.id === id);
        if (item) {
          setDraft(item);
        }
      });
    });

    return () => {
      offData();
      offFocus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }

        if (tickTickModalOpen) {
          setTickTickModalOpen(false);
          return;
        }

        if (statusMenuId) {
          setStatusMenuId(null);
          return;
        }

        void window.reminderApi.performMenuAction("view-exit-fullscreen");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, statusMenuId, tickTickModalOpen]);

  useEffect(() => {
    setTickTickDraft(data.settings.tickTickSync);
  }, [data.settings.tickTickSync]);

  const sortedReminders = useMemo(
    () =>
      [...data.reminders].sort(
        (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
      ),
    [data.reminders]
  );

  const activeReminders = useMemo(
    () => sortedReminders.filter((item) => !isCompleted(item)),
    [sortedReminders]
  );

  const completedReminders = useMemo(
    () => sortedReminders.filter((item) => isCompleted(item)),
    [sortedReminders]
  );

  const inProgressReminders = useMemo(
    () => activeReminders.filter((item) => isInProgress(item)),
    [activeReminders]
  );

  const visibleReminders = useMemo(() => {
    if (activeView === "today") {
      return activeReminders.filter((item) => item.enabled && isToday(item.startAt));
    }
    if (activeView === "previous") {
      return activeReminders.filter((item) => item.enabled && isBeforeToday(item.startAt));
    }
    if (activeView === "future") {
      return activeReminders.filter((item) => item.enabled && isFuture(item.startAt));
    }
    if (activeView === "inProgress") {
      return inProgressReminders;
    }
    if (activeView === "completed") {
      return completedReminders;
    }
    if (activeView === "disabled") {
      return activeReminders.filter((item) => !item.enabled);
    }
    return activeReminders;
  }, [activeReminders, activeView, completedReminders, inProgressReminders]);

  const navItems = useMemo(
    () => [
      { key: "all" as const, label: "全部", icon: ListTodo, count: activeReminders.length },
      { key: "today" as const, label: "今天", icon: CalendarClock, count: activeReminders.filter((item) => item.enabled && isToday(item.startAt)).length },
      { key: "previous" as const, label: "之前", icon: History, count: activeReminders.filter((item) => item.enabled && isBeforeToday(item.startAt)).length },
      { key: "future" as const, label: "之后", icon: Inbox, count: activeReminders.filter((item) => item.enabled && isFuture(item.startAt)).length },
      { key: "inProgress" as const, label: "进行中", icon: Clock3, count: inProgressReminders.length },
      { key: "completed" as const, label: "已完成", icon: ListChecks, count: completedReminders.length },
      { key: "disabled" as const, label: "已停用", icon: Power, count: activeReminders.filter((item) => !item.enabled).length }
    ],
    [activeReminders, completedReminders, inProgressReminders]
  );

  const viewTitle = navItems.find((item) => item.key === activeView)?.label ?? "全部";

  const saveDraft = async (): Promise<void> => {
    if (!draft || !draft.title.trim()) {
      setStatus("标题不能为空。");
      return;
    }

    const next = await window.reminderApi.saveReminder({
      ...draft,
      title: draft.title.trim(),
      leadMinutes: draft.leadMinutes.length ? draft.leadMinutes : [15],
      recurrenceRule: {
        ...draft.recurrenceRule,
        interval: Math.max(1, draft.recurrenceRule.interval || 1)
      }
    });
    setData(next);
    setSelectedId(draft.id);
    setStatus("已保存。");
  };

  const deleteSelected = async (): Promise<void> => {
    if (!draft) {
      return;
    }

    const next = await window.reminderApi.deleteReminder(draft.id);
    setData(next);
    const first = next.reminders[0] ?? null;
    setSelectedId(first?.id ?? null);
    setDraft(first);
    setStatus("已删除。");
  };

  const createReminder = (): void => {
    const item = newReminder(data.settings);
    setSelectedId(item.id);
    setDraft(item);
    setStatus("正在编辑新提醒，点击保存后创建。");
  };

  const selectReminder = (item: ReminderItem): void => {
    setStatusMenuId(null);
    setSelectedId(item.id);
    setDraft(item);
    setStatus("");
  };

  const completeReminder = async (item: ReminderItem): Promise<void> => {
    setStatusMenuId(null);
    const completed = isCompleted(item);
    if (completed) {
      setSelectedId(item.id);
      setDraft(item);
      setStatus("该任务已经完成。");
      return;
    }

    if (!completed && isRecurringReminder(item)) {
      const after = new Date(Math.max(Date.now(), new Date(item.startAt).getTime()));
      const nextOccurrence = getNextOccurrenceAfter(item, after, data.settings);

      if (nextOccurrence) {
        const next = await window.reminderApi.saveReminder({
          ...item,
          startAt: nextOccurrence.toISOString(),
          completedAt: null,
          enabled: true,
          progressStatus: "todo",
          progressSnoozedUntil: null
        });
        const saved = next.reminders.find((reminder) => reminder.id === item.id) ?? null;

        setData(next);
        setSelectedId(saved?.id ?? null);
        setDraft(saved);
        setStatus("已完成本次，已生成下次提醒。");
        return;
      }
    }

    const next = await window.reminderApi.saveReminder({
      ...item,
      completedAt: new Date().toISOString(),
      enabled: false,
      progressStatus: "todo",
      progressSnoozedUntil: null
    });
    const saved = next.reminders.find((reminder) => reminder.id === item.id) ?? null;

    setData(next);
    setSelectedId(saved?.id ?? null);
    setDraft(saved);
    setActiveView("completed");
    setStatus("已完成，已移入已完成。");
  };

  const markInProgress = async (item: ReminderItem): Promise<void> => {
    setStatusMenuId(null);
    const next = await window.reminderApi.saveReminder({
      ...item,
      completedAt: null,
      enabled: true,
      progressStatus: "inProgress",
      progressSnoozedUntil: inProgressSnoozedUntil()
    });
    const saved = next.reminders.find((reminder) => reminder.id === item.id) ?? null;

    setData(next);
    setSelectedId(saved?.id ?? null);
    setDraft(saved);
    setActiveView("inProgress");
    setStatus("已标记为进行中，30 分钟后会再次飘窗。");
  };

  const updateSettings = async (settings: AppSettings): Promise<void> => {
    const next = await window.reminderApi.saveSettings(settings);
    setData(next);
    setStatus("设置已保存。");
  };

  const saveTickTickSettings = async (): Promise<void> => {
    const next = await window.reminderApi.saveSettings({
      ...data.settings,
      tickTickSync: tickTickDraft
    });
    setData(next);
    setStatus("滴答清单配置已保存。");
  };

  const connectTickTick = async (): Promise<void> => {
    setStatus("请在浏览器完成滴答清单授权。");
    try {
      const next = await window.reminderApi.connectTickTick(tickTickDraft);
      setData(next);
      setStatus("滴答清单已连接。");
    } catch (error) {
      setStatus(`连接失败：${errorMessage(error)}`);
    }
  };

  const syncTickTick = async (): Promise<void> => {
    setStatus("正在同步滴答清单任务。");
    try {
      const result = await window.reminderApi.syncTickTick(tickTickDraft);
      setData(result.data);
      setStatus(`同步完成：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}。`);
    } catch (error) {
      setStatus(`同步失败：${errorMessage(error)}`);
    }
  };

  const runMenuAction = (action: string): void => {
    setOpenMenu(null);
    void window.reminderApi.performMenuAction(action);
  };

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-menu" aria-label="应用菜单" onMouseLeave={() => setOpenMenu(null)}>
          {menuGroups.map((group) => (
            <div
              key={group.key}
              className="app-menu-item"
              onMouseEnter={() => setOpenMenu(group.key)}
            >
              <button
                className={`app-menu-trigger ${openMenu === group.key ? "active" : ""}`}
                type="button"
                onClick={() => setOpenMenu(group.key)}
              >
                {group.label}
              </button>
              {openMenu === group.key ? (
                <div className="app-menu-panel" role="menu">
                  {group.items.map((item) => (
                    <button
                      key={item.action}
                      className={`app-menu-option ${item.separatorBefore ? "with-separator" : ""}`}
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuAction(item.action)}
                    >
                      <span>{item.label}</span>
                      {"shortcut" in item ? <kbd>{item.shortcut}</kbd> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="titlebar-drag" />

      </header>

      <div className="workspace-grid">
      <aside className="nav-sidebar">
        <nav className="nav-list" aria-label="提醒分类">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`nav-item ${activeView === item.key ? "active" : ""}`}
                type="button"
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-settings">
          <button type="button" className="settings-open-button" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
            设置
          </button>
          <button type="button" className="settings-open-button" onClick={() => setTickTickModalOpen(true)}>
            <Settings size={16} />
            滴答清单同步
          </button>
        </div>
      </aside>

      <section className="list-pane">
        <header className="pane-header">
          <div>
            <h2>{viewTitle}</h2>
            <p>{visibleReminders.length} 个提醒</p>
          </div>
          <button className="add-button" type="button" title="新建提醒" onClick={createReminder}>
            <Plus size={18} />
          </button>
        </header>

        <div className="quick-tip">
          <Volume2 size={16} />
          到点后会在屏幕中间飘过提醒条。
        </div>

        <div className="reminder-list">
          {visibleReminders.length === 0 ? (
            <div className="empty-list">这个清单里还没有提醒。</div>
          ) : (
            visibleReminders.map((item) => {
              const completed = isCompleted(item);
              const inProgress = isInProgress(item);

              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={`reminder-row ${item.id === selectedId ? "selected" : ""} ${completed ? "completed" : ""} ${inProgress ? "in-progress" : ""}`}
                  onClick={() => selectReminder(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectReminder(item);
                    }
                  }}
                >
                  <span className="status-action">
                    <button
                      type="button"
                      className={`complete-toggle ${completed ? "completed" : ""} ${inProgress ? "in-progress" : ""}`}
                      title="选择任务状态"
                      aria-label="选择任务状态"
                      onClick={(event) => {
                        event.stopPropagation();
                        setStatusMenuId((current) => (current === item.id ? null : item.id));
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {completed ? <SquareCheck size={18} /> : inProgress ? <Clock3 size={18} /> : <Square size={18} />}
                    </button>
                    {statusMenuId === item.id ? (
                      <span className="status-choice-menu" onClick={(event) => event.stopPropagation()}>
                        <button type="button" className="complete-choice" onClick={() => void completeReminder(item)}>
                          <SquareCheck size={15} />
                          完成
                        </button>
                        <button type="button" className="progress-choice" onClick={() => void markInProgress(item)}>
                          <Clock3 size={15} />
                          进行中
                        </button>
                      </span>
                    ) : null}
                  </span>
                  <span className="reminder-main">
                    <span className="reminder-title">{item.title}</span>
                    <span className="reminder-meta">
                      {inProgress ? <span className="progress-label">进行中</span> : null}
                      {new Date(item.startAt).toLocaleString()} · 提前 {item.leadMinutes.join(" / ")} 分钟
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <main className="detail-pane">
        {draft ? (
          <>
            <header className="detail-header">
              <input
                className="title-input"
                aria-label="提醒标题"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <label className="switch-row detail-switch">
                <span>启用</span>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
              </label>
            </header>

            <label className="form-row">
              <span>说明</span>
              <textarea
                rows={4}
                value={draft.description}
                placeholder="补充会议链接、地点或注意事项"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>

            <div className="form-row time-picker">
              <div className="time-label-row">
                <label htmlFor="startDate">时间</label>
                <button
                  type="button"
                  className="now-button"
                  onClick={() => setDraft({ ...draft, startAt: currentMinuteIso() })}
                >
                  此刻
                </button>
              </div>
              <div className="time-control-row">
                <input
                  id="startDate"
                  className="time-date-input"
                  type="date"
                  value={dateInputValue(draft.startAt)}
                  onChange={(event) => setDraft({ ...draft, startAt: updateDatePart(draft.startAt, event.target.value) })}
                />
                <select
                  className="time-hour-select"
                  value={hourValue(draft.startAt)}
                  onChange={(event) => setDraft({ ...draft, startAt: updateHourPart(draft.startAt, Number(event.target.value)) })}
                >
                  {HOUR_OPTIONS.map((hour) => (
                    <option key={hour} value={hour}>
                      {pad2(hour)} 时
                    </option>
                  ))}
                </select>
              </div>
              <div className="minute-option-row" aria-label="分钟">
                {MINUTE_OPTIONS.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    className={`minute-option ${roundedMinuteValue(draft.startAt) === minute ? "active" : ""}`}
                    onClick={() => setDraft({ ...draft, startAt: updateMinutePart(draft.startAt, minute) })}
                  >
                    {pad2(minute)}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-row">
              <label>提前提醒</label>
              <div className="chip-grid">
                {LEAD_MINUTES.map((minute) => (
                  <label key={minute} className={`chip ${draft.leadMinutes.includes(minute) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={draft.leadMinutes.includes(minute)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...draft.leadMinutes, minute]
                          : draft.leadMinutes.filter((value) => value !== minute);
                        setDraft({
                          ...draft,
                          leadMinutes: next.sort((left, right) => left - right) as LeadMinutes[]
                        });
                      }}
                    />
                    {minute} 分钟
                  </label>
                ))}
              </div>
            </div>

            <details className="drawer" open={draft.recurrenceRule.frequency !== "none"}>
              <summary>
                <CalendarClock size={17} />
                重复与工作日
              </summary>
              <div className="drawer-content">
                <div className="form-row three-column">
                  <div>
                    <label htmlFor="frequency">频率</label>
                    <select
                      id="frequency"
                      value={draft.recurrenceRule.frequency}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          recurrenceRule: {
                            ...draft.recurrenceRule,
                            frequency: event.target.value as ReminderItem["recurrenceRule"]["frequency"]
                          }
                        })
                      }
                    >
                      <option value="none">不重复</option>
                      <option value="daily">每日</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                      <option value="yearly">每年</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="interval">间隔</label>
                    <input
                      id="interval"
                      type="number"
                      min={1}
                      value={draft.recurrenceRule.interval}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          recurrenceRule: {
                            ...draft.recurrenceRule,
                            interval: Number(event.target.value)
                          }
                        })
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="count">次数上限</label>
                    <input
                      id="count"
                      type="number"
                      min={1}
                      value={draft.recurrenceRule.count ?? ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          recurrenceRule: {
                            ...draft.recurrenceRule,
                            count: event.target.value ? Number(event.target.value) : null
                          }
                        })
                      }
                    />
                  </div>
                </div>

                {draft.recurrenceRule.frequency === "weekly" ? (
                  <div className="form-row">
                    <label>星期</label>
                    <div className="weekday-row">
                      {weekdays.map((day) => (
                        <label key={day.value} className={`chip ${draft.recurrenceRule.weekdays.includes(day.value) ? "active" : ""}`}>
                          <input
                            type="checkbox"
                            checked={draft.recurrenceRule.weekdays.includes(day.value)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...draft.recurrenceRule.weekdays, day.value]
                                : draft.recurrenceRule.weekdays.filter((value) => value !== day.value);
                              setDraft({
                                ...draft,
                                recurrenceRule: {
                                  ...draft.recurrenceRule,
                                  weekdays: next.sort()
                                }
                              });
                            }}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {draft.recurrenceRule.frequency === "monthly" || draft.recurrenceRule.frequency === "yearly" ? (
                  <div className="form-row two-column">
                    <div>
                      <label htmlFor="monthDays">月内日期</label>
                      <input
                        id="monthDays"
                        placeholder="例如 1, 15, 28"
                        value={formatNumberList(draft.recurrenceRule.monthDays)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            recurrenceRule: {
                              ...draft.recurrenceRule,
                              monthDays: parseNumberList(event.target.value, 1, 31)
                            }
                          })
                        }
                      />
                    </div>
                    {draft.recurrenceRule.frequency === "yearly" ? (
                      <div>
                        <label htmlFor="months">月份</label>
                        <input
                          id="months"
                          placeholder="例如 1, 6, 12"
                          value={formatNumberList(draft.recurrenceRule.months)}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              recurrenceRule: {
                                ...draft.recurrenceRule,
                                months: parseNumberList(event.target.value, 1, 12)
                              }
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="form-row two-column">
                  <div>
                    <label htmlFor="endDate">结束日期</label>
                    <input
                      id="endDate"
                      type="date"
                      value={draft.recurrenceRule.endDate ?? ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          recurrenceRule: {
                            ...draft.recurrenceRule,
                            endDate: event.target.value || null
                          }
                        })
                      }
                    />
                  </div>
                  <div className="stacked-toggles">
                    <label className="switch-row">
                      <span>仅工作日</span>
                      <input
                        type="checkbox"
                        checked={draft.holidayPolicy.workdayOnly}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            holidayPolicy: { ...draft.holidayPolicy, workdayOnly: event.target.checked }
                          })
                        }
                      />
                    </label>
                    <label className="switch-row">
                      <span>中国节假日/调休</span>
                      <input
                        type="checkbox"
                        checked={draft.holidayPolicy.useChinaHolidays}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            holidayPolicy: { ...draft.holidayPolicy, useChinaHolidays: event.target.checked }
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>

            <footer className="detail-actions">
              <div className="status-line">
                <Check size={16} />
                {status || "更改后点击保存。"}
              </div>
              <div className="button-row">
                <button type="button" className="danger-action" onClick={() => void deleteSelected()}>
                  <Trash2 size={18} />
                  删除
                </button>
                <button type="button" className="primary-action inline" onClick={() => void saveDraft()}>
                  <Save size={18} />
                  保存
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="empty-editor">选择一个提醒，或新建提醒。</div>
        )}
      </main>
      </div>
      {settingsOpen ? (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="settings-modal-header">
              <h2 id="settings-modal-title">
                <Settings size={18} />
                设置
              </h2>
              <button
                type="button"
                className="modal-close-button"
                aria-label="关闭设置"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="settings-modal-content">
              <section className="settings-section">
                <h3>常用</h3>
                <label className="switch-row">
                  <span>开机启动</span>
                  <input
                    type="checkbox"
                    checked={data.settings.startAtLogin}
                    onChange={(event) => void updateSettings({ ...data.settings, startAtLogin: event.target.checked })}
                  />
                </label>
                <label className="switch-row">
                  <span>提示音</span>
                  <input
                    type="checkbox"
                    checked={data.settings.soundEnabled}
                    onChange={(event) => void updateSettings({ ...data.settings, soundEnabled: event.target.checked })}
                  />
                </label>
              </section>

              <section className="settings-section">
                <h3>更多设置</h3>
                <label className="setting-field">
                  <span>循环间隔（秒）</span>
                  <input
                    type="number"
                    min={10}
                    value={data.settings.overlayRepeatSeconds}
                    onChange={(event) =>
                      void updateSettings({
                        ...data.settings,
                        overlayRepeatSeconds: Math.max(10, Number(event.target.value))
                      })
                    }
                  />
                </label>
                <label className="setting-field">
                  <span>手动节假日</span>
                  <textarea
                    rows={2}
                    value={data.settings.holidayOverrides.holidays.join(", ")}
                    onChange={(event) =>
                      void updateSettings({
                        ...data.settings,
                        holidayOverrides: {
                          ...data.settings.holidayOverrides,
                          holidays: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean)
                        }
                      })
                    }
                  />
                </label>
                <label className="setting-field">
                  <span>手动补班日</span>
                  <textarea
                    rows={2}
                    value={data.settings.holidayOverrides.workdays.join(", ")}
                    onChange={(event) =>
                      void updateSettings({
                        ...data.settings,
                        holidayOverrides: {
                          ...data.settings.holidayOverrides,
                          workdays: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean)
                        }
                      })
                    }
                  />
                </label>
              </section>

              <section className="settings-section">
                <h3>数据</h3>
                <div className="settings-data-actions">
                  <button
                    type="button"
                    onClick={() => window.reminderApi.importBackup().then(() => setStatus("导入完成。"))}
                  >
                    <Upload size={16} />
                    导入
                  </button>
                  <button
                    type="button"
                    onClick={() => window.reminderApi.exportBackup().then(() => setStatus("导出完成。"))}
                  >
                    <Download size={16} />
                    导出
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
      {tickTickModalOpen ? (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setTickTickModalOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticktick-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="settings-modal-header">
              <h2 id="ticktick-modal-title">
                <Settings size={18} />
                滴答清单同步
              </h2>
              <button
                type="button"
                className="modal-close-button"
                aria-label="关闭滴答清单同步"
                onClick={() => setTickTickModalOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="settings-modal-content">
              <section className="settings-section">
                <label className="setting-field">
                  <span>账号区域</span>
                  <select
                    value={tickTickDraft.service}
                    onChange={(event) =>
                      setTickTickDraft({ ...tickTickDraft, service: event.target.value as typeof tickTickDraft.service })
                    }
                  >
                    <option value="dida365">滴答清单</option>
                    <option value="ticktick">TickTick</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>客户端 ID</span>
                  <input
                    value={tickTickDraft.clientId}
                    onChange={(event) => setTickTickDraft({ ...tickTickDraft, clientId: event.target.value })}
                  />
                </label>
                <label className="setting-field">
                  <span>客户端密钥</span>
                  <input
                    type="password"
                    value={tickTickDraft.clientSecret}
                    onChange={(event) => setTickTickDraft({ ...tickTickDraft, clientSecret: event.target.value })}
                  />
                </label>
                <label className="setting-field">
                  <span>回调地址</span>
                  <input
                    value={tickTickDraft.redirectUri}
                    onChange={(event) => setTickTickDraft({ ...tickTickDraft, redirectUri: event.target.value })}
                  />
                </label>
                <p className="setting-note">先在滴答清单开发者中心创建应用，并保存相同回调地址。</p>
                <p className="setting-note">OAuth Error 通常表示网页应用里没有登记回调地址。</p>
                <p className="setting-note">
                  上次同步：{tickTickDraft.lastSyncAt ? new Date(tickTickDraft.lastSyncAt).toLocaleString() : "未同步"}
                </p>
                <div className="settings-sync-actions">
                  <button type="button" onClick={() => void saveTickTickSettings()}>
                    <Save size={16} />
                    保存
                  </button>
                  <button type="button" onClick={() => void connectTickTick()}>
                    <Plug size={16} />
                    连接
                  </button>
                  <button type="button" onClick={() => void syncTickTick()}>
                    <RefreshCw size={16} />
                    同步
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
