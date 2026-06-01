import { getDueAlerts, getUnconfirmedAlerts } from "../shared/scheduler";
import { AlertOccurrence } from "../shared/types";
import { MINUTE_MS } from "../shared/date";
import { ReminderStore } from "./store";

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly store: ReminderStore,
    private readonly onAlert: (alert: AlertOccurrence) => void | Promise<void>
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 15_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      const data = await this.store.getData();
      const now = new Date();
      const windowStart = data.settings.lastSchedulerCheckAt
        ? new Date(data.settings.lastSchedulerCheckAt)
        : new Date(now.getTime() - 24 * 60 * MINUTE_MS);

      const due = getDueAlerts(data.reminders, data.alerts, data.settings, now, windowStart);
      const unconfirmed = getUnconfirmedAlerts(data.reminders, data.alerts);
      const repeatAfter = Math.max(10, data.settings.overlayRepeatSeconds) * 1_000;

      for (const alert of [...due, ...unconfirmed]) {
        const current = (await this.store.getData()).alerts[alert.key];
        if (current?.confirmedAt) {
          continue;
        }

        if (current?.lastShownAt && now.getTime() - new Date(current.lastShownAt).getTime() < repeatAfter) {
          continue;
        }

        await this.store.markAlertShown(alert);
        await this.onAlert(alert);
      }

      await this.store.setLastSchedulerCheck(now.toISOString());
    } finally {
      this.ticking = false;
    }
  }
}
