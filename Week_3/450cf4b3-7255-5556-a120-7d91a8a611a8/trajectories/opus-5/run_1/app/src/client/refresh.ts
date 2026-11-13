type Task = () => void;

/** The one refresh mechanism every screen with a periodic re-read uses. */
export class Refreshes {
  private timers: number[] = [];

  every(intervalMs: number, task: Task): void {
    this.timers.push(window.setInterval(task, intervalMs));
  }

  stop(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
  }
}

export const KITCHEN_CLOCK_MS = 1000;
export const COUNTDOWN_MS = 1000;
export const FLOOR_MS = 10_000;
export const DOOR_MS = 15_000;
export const PACKS_MS = 10_000;
export const DOCUMENTS_MS = 10_000;
export const TENANT_MS = 10_000;
export const RECEIPT_MS = 10_000;
export const REPORT_MS = 10_000;
