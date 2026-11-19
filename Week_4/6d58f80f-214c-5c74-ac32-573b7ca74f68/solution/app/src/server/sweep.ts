// The expiry sweep: at least every 5 seconds, and once more before PUT /api/clock replies (brief: Timeliness).
import { pool } from "./db.js";
import { now, today } from "./clock.js";
import { endDueGrants } from "./grants.js";
import { lapseDue } from "./handovers.js";
import { expireUploads } from "./uploads.js";
import { purgeDue } from "./bin.js";
import { broadcastLocal } from "./hub.js";

export const SWEEP_MS = 5_000;
const IDEMPOTENCY_KEEP_MS = 48 * 3_600_000;
let queue: Promise<void> = Promise.resolve();
let lastDay = today();

async function step(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`sweep step ${name} failed:`, error instanceof Error ? error.message : error);
  }
}

async function runOnce(): Promise<void> {
  await step("grants", endDueGrants);
  await step("handovers", lapseDue);
  await step("uploads", expireUploads);
  await step("bin", purgeDue);
  await step("housekeeping", async () => {
    await pool.query("DELETE FROM outbox WHERE created_at < now() - interval '10 minutes'");
    await pool.query("DELETE FROM idempotency_keys WHERE created_at < $1", [new Date(now().getTime() - IDEMPOTENCY_KEEP_MS)]);
  });
  const day = today();
  if (day !== lastDay) {
    lastDay = day;
    broadcastLocal({ type: "day", data: { today: day } });
  }
}

/** Queues a sweep after any running one and resolves when it has finished. */
export function sweep(): Promise<void> {
  const run = queue.then(runOnce);
  queue = run.catch(() => undefined);
  return run;
}
