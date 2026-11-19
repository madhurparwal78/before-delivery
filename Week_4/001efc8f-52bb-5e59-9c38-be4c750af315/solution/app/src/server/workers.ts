import { addSeconds, now } from "./clock.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { runDueDigests } from "./domain/digest.js";
import { retryInvites } from "./domain/people.js";
import { processRemovals } from "./domain/removalQueue.js";
import { fireDueScheduledPosts } from "./domain/schedule.js";

// Background work shared safely between app processes: every job claims rows with locks.
function every(ms: number, job: () => Promise<void>, runNow = true): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (error) {
      console.error(`background job failed: ${error instanceof Error ? ((error as Error & { code?: string }).code ?? error.name) : "unknown"}`);
    } finally {
      running = false;
    }
  };
  if (runNow) void tick();
  setInterval(() => void tick(), ms).unref();
}

export function startWorkers(): void {
  every(1_000, fireDueScheduledPosts);
  every(1_000, runDueDigests);
  every(30_000, () => processRemovals(null, 5_000));
  every(30_000, retryInvites, false);
  every(60_000, async () => {
    await pool.query("DELETE FROM events WHERE created_at < $1", [addSeconds(now(), -config.eventRetentionSeconds)]);
  });
}
