import { pool } from "./db.js";
import { endReminderCooldowns, expireDue, sealDue } from "./domain/workflow.js";
import { isHealthy, runChecks } from "./health.js";
import { retryHeldMail } from "./mail/outbox.js";

const TICK_MS = 1000;
const HEALTH_MS = 5000;

function guarded(task: () => Promise<void>): () => void {
  let running = false;
  return () => {
    if (running) return;
    running = true;
    task()
      .catch((error: unknown) => console.error("background task failed", error))
      .finally(() => {
        running = false;
      });
  };
}

export function startWorkers(): void {
  setInterval(guarded(() => runChecks()), HEALTH_MS);
  setInterval(
    guarded(async () => {
      await expireDue(pool);
      await endReminderCooldowns();
      if (isHealthy()) {
        await retryHeldMail();
        await sealDue();
      }
    }),
    TICK_MS,
  );
}
