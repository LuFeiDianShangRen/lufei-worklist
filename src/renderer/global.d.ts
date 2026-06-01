import { ReminderApi } from "../preload/preload";

declare global {
  interface Window {
    reminderApi: ReminderApi;
  }
}
