// Background work on every instance, every DELIVERY_RETRY_SECONDS. Each item is claimed under a Postgres lease.
import { config } from "./config.js";
import { db, tx } from "./db.js";
import { ensureCatalog, refreshAll } from "./billing.js";
import { retryQueued } from "./invites.js";
import { retryRecaps } from "./recap.js";
import { purgeDue } from "./trash.js";
import { imageKey } from "./images.js";
import { deleteObject, StorageDown } from "./storage.js";
import { pruneCounters } from "./rateLimit.js";

async function retryImageDeletions(): Promise<void> {
  const claimed = await db.rows<{ image_id: string; workshop_id: string }>(
    `UPDATE image_deletions SET lease_until = now() + interval '30 seconds', attempts = attempts + 1 WHERE image_id IN (
       SELECT image_id FROM image_deletions WHERE lease_until IS NULL OR lease_until < now() LIMIT 50 FOR UPDATE SKIP LOCKED)
     RETURNING image_id, workshop_id`,
  );
  for (const item of claimed) {
    try {
      await deleteObject(imageKey(item.workshop_id, item.image_id));
      await db.run("DELETE FROM image_deletions WHERE image_id = $1", [item.image_id]);
    } catch (error) {
      if (!(error instanceof StorageDown)) throw error;
      await db.run("UPDATE image_deletions SET lease_until = NULL WHERE image_id = $1", [item.image_id]);
    }
  }
}

const TASKS: [string, () => Promise<void>][] = [
  ["catalog", ensureCatalog],
  ["billing", refreshAll],
  ["invites", retryQueued],
  ["recaps", retryRecaps],
  ["purge", () => tx(purgeDue)],
  ["images", retryImageDeletions],
  ["counters", pruneCounters],
];

let running = false;

export async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const [name, task] of TASKS) {
      try {
        await task();
      } catch (error) {
        console.error(`worker ${name}: ${(error as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  setInterval(() => void tick(), Math.max(1, config.deliveryRetrySeconds) * 1000).unref();
}
