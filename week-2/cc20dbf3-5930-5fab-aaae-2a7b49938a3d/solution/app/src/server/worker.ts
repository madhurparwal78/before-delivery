// Background work, independent of requests: pickup-window expiry, due reminders and the email queue.
// Every copy of the server runs it; row locks and unique keys make each effect happen once.

import { expireLapsedHolds } from "./domain/holds.js";
import { queueDueReminders } from "./domain/loans.js";
import { describeError } from "./log.js";
import { sendQueuedEmail } from "./services/mail.js";

const INTERVAL_MS = 2_000;

const steps: [string, (now: Date) => Promise<void>][] = [
  ["hold expiry", expireLapsedHolds],
  ["due reminders", queueDueReminders],
  ["email queue", () => sendQueuedEmail()],
];

export function startWorker(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      for (const [name, step] of steps) {
        try {
          await step(new Date());
        } catch (error) {
          console.error(`${name} failed: ${describeError(error)}`);
        }
      }
      running = false;
    })();
  }, INTERVAL_MS);
}
