// @vitest-environment jsdom
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { AppData, defaultHolidayPolicy, defaultRecurrenceRule, defaultSettings, ReminderItem } from "../src/shared/types";

function emptyData(): AppData {
  return {
    version: 1,
    reminders: [],
    alerts: {},
    settings: defaultSettings()
  };
}

function reminder(id: string, title: string, startAt = "2026-05-30T10:00:00.000Z"): ReminderItem {
  const now = new Date("2026-05-30T00:00:00.000Z").toISOString();
  return {
    id,
    title,
    description: "",
    startAt,
    leadMinutes: [15],
    recurrenceRule: defaultRecurrenceRule(),
    holidayPolicy: defaultHolidayPolicy(),
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

describe("renderer reminder creation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let data: AppData;
  let saveReminder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    data = emptyData();
    saveReminder = vi.fn(async (item: ReminderItem) => {
      data = {
        ...data,
        reminders: [...data.reminders.filter((existing) => existing.id !== item.id), item]
      };
      return data;
    });

    Object.defineProperty(window, "reminderApi", {
      configurable: true,
      value: {
        getData: vi.fn(async () => data),
        saveReminder,
        deleteReminder: vi.fn(),
        saveSettings: vi.fn(async () => data),
        exportBackup: vi.fn(),
        importBackup: vi.fn(),
        acknowledgeAlert: vi.fn(),
        performMenuAction: vi.fn(),
        onDataChanged: vi.fn(() => () => undefined),
        onFocusReminder: vi.fn(() => () => undefined),
        onOverlayAlert: vi.fn(() => () => undefined),
        acknowledgeOverlay: vi.fn()
      }
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens an unsaved draft when the plus button is clicked", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const addButton = container.querySelector<HTMLButtonElement>(".add-button");
    expect(addButton).not.toBeNull();

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(saveReminder).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>(".title-input")?.value).toBe("新提醒");
    expect(container.textContent).toContain("0 个提醒");
    expect(container.textContent).toContain("点击保存后创建");
  });

  it("persists a new draft only after save is clicked", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".add-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".primary-action.inline")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(saveReminder).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".reminder-title")?.textContent).toBe("新提醒");
    expect(container.textContent).toContain("1 个提醒");
  });

  it("switches the editor when a different reminder is clicked", async () => {
    data = {
      ...data,
      reminders: [reminder("a", "第一个任务"), reminder("b", "第二个任务")]
    };

    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector<HTMLInputElement>(".title-input")?.value).toBe("第一个任务");

    const rows = Array.from(container.querySelectorAll<HTMLElement>(".reminder-row"));
    await act(async () => {
      rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector<HTMLInputElement>(".title-input")?.value).toBe("第二个任务");
  });

  it("shows status choices and moves a reminder to completed when completed is selected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T08:00:00.000Z"));
    data = {
      ...data,
      reminders: [reminder("a", "要完成的任务")]
    };

    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".complete-toggle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(saveReminder).not.toHaveBeenCalled();
    expect(container.querySelector(".status-choice-menu")?.textContent).toContain("完成");
    expect(container.querySelector(".status-choice-menu")?.textContent).toContain("进行中");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".complete-choice")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saved = saveReminder.mock.calls[0]?.[0] as ReminderItem;
    expect(saved.completedAt).toBe("2026-06-02T08:00:00.000Z");
    expect(saved.enabled).toBe(false);
    expect(saved.progressStatus).toBe("todo");
    expect(container.textContent).toContain("已完成");
    expect(container.querySelector(".reminder-title")?.textContent).toBe("要完成的任务");
  });

  it("marks a reminder as in progress from the status choices", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T08:00:00.000Z"));
    data = {
      ...data,
      reminders: [reminder("a", "正在做的任务")]
    };

    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".complete-toggle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".progress-choice")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saved = saveReminder.mock.calls[0]?.[0] as ReminderItem;
    expect(saved.completedAt).toBeNull();
    expect(saved.enabled).toBe(true);
    expect(saved.progressStatus).toBe("inProgress");
    expect(saved.progressSnoozedUntil).toBe("2026-06-02T08:30:00.000Z");
    expect(container.querySelector(".pane-header")?.textContent).toContain("进行中");
    expect(container.querySelector(".reminder-row")?.className).toContain("in-progress");
  });

  it("advances a recurring reminder instead of completing the whole task", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T08:00:00.000Z"));
    data = {
      ...data,
      reminders: [
        {
          ...reminder("a", "每天重复", "2026-06-02T10:00:00.000Z"),
          recurrenceRule: {
            ...defaultRecurrenceRule(),
            frequency: "daily"
          }
        }
      ]
    };

    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".complete-toggle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".complete-choice")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saved = saveReminder.mock.calls[0]?.[0] as ReminderItem;
    expect(saved.completedAt).toBeNull();
    expect(saved.enabled).toBe(true);
    expect(saved.startAt).toBe("2026-06-03T10:00:00.000Z");
    expect(saved.progressStatus).toBe("todo");
    expect(container.textContent).toContain("已完成本次，已生成下次提醒。");
  });

  it("sets the reminder time to the nearest five-minute step when now is clicked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T08:09:30"));
    data = {
      ...data,
      reminders: [reminder("a", "要调整时间")]
    };

    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".now-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector<HTMLInputElement>("#startDate")?.value).toBe("2026-05-31");
    expect(container.querySelector<HTMLSelectElement>(".time-hour-select")?.value).toBe("8");
    expect(container.querySelector<HTMLButtonElement>(".minute-option.active")?.textContent).toBe("10");
  });

  it("offers minute choices in five-minute steps", async () => {
    data = {
      ...data,
      reminders: [reminder("a", "要调整时间")]
    };

    await act(async () => {
      root.render(<App />);
    });

    const options = Array.from(container.querySelectorAll<HTMLButtonElement>(".minute-option")).map((button) =>
      button.textContent
    );
    expect(options).toEqual(["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  });

  it("opens settings and TickTick sync from sidebar modal entries", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const sidebarSettings = container.querySelector(".sidebar-settings");
    expect(sidebarSettings?.textContent).toContain("设置");
    expect(sidebarSettings?.textContent).toContain("滴答清单同步");
    expect(sidebarSettings?.textContent).not.toContain("开机启动");
    expect(sidebarSettings?.textContent).not.toContain("客户端 ID");
    expect(sidebarSettings?.textContent).not.toContain("导入");

    const entryButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-open-button"));

    await act(async () => {
      entryButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".settings-modal")?.textContent).toContain("开机启动");
    expect(container.querySelector(".settings-modal")?.textContent).toContain("更多设置");
    expect(container.querySelector(".settings-modal")?.textContent).toContain("导入");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".modal-close-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      entryButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".settings-modal")?.textContent).toContain("账号区域");
    expect(container.querySelector(".settings-modal")?.textContent).toContain("客户端 ID");
    expect(container.querySelector(".settings-modal")?.textContent).toContain("同步");
  });

  it("shows yesterday and earlier reminders in the previous view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T09:00:00.000Z"));
    data = {
      ...data,
      reminders: [
        reminder("past", "昨天任务", "2026-06-02T10:00:00.000Z"),
        reminder("today", "今天任务", "2026-06-03T10:00:00.000Z")
      ]
    };

    await act(async () => {
      root.render(<App />);
    });

    const previousButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find((button) =>
      button.textContent?.includes("之前")
    );

    await act(async () => {
      previousButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".pane-header")?.textContent).toContain("之前");
    expect(container.textContent).toContain("昨天任务");
    expect(container.querySelector(".reminder-list")?.textContent).not.toContain("今天任务");
  });
});
