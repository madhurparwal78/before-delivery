// Background work that runs whether or not any page is open: hold expiry, mail delivery and the
// compliance scan. Every task claims its rows so several app copies can share one database.

import { config } from "./config.js";
import { expireDueHolds } from "./domain/bookings.js";
import { runComplianceScan } from "./domain/compliance.js";
import { deliverDueNotifications } from "./domain/outbox.js";

function every(ms: number, name: string, task: () => Promise<void>): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      console.error(`${name} failed:`, error);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), ms).unref();
}

export function startWorkers(): void {
  every(1000, "hold expiry", () => expireDueHolds());
  every(500, "outbox", deliverDueNotifications);
  every(config.complianceScanSeconds * 1000, "compliance scan", runComplianceScan);
}
