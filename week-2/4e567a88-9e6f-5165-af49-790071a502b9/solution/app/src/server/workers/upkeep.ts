// Upkeep that runs on its own: pending top-ups retried every 15 seconds, and expired media removed from
// storage within 15 seconds of its expiry instant.

import { pool, rows } from "../db";
import { completeTopup } from "../domain/topups";
import { storageDown } from "../services/status";
import { deleteObject, StorageUnavailable } from "../services/storage";
import { loop } from "./loop";

const TOPUP_RETRY_MS = 15_000;
const SWEEP_MS = 5_000;

async function retryTopups(): Promise<void> {
  const pending = await rows<{ id: string }>(pool,
    "SELECT id FROM topups WHERE status = 'pending' AND pending_reason = 'billing_unavailable' ORDER BY number");
  for (const { id } of pending) await completeTopup(id);
}

async function sweep(): Promise<void> {
  if (storageDown()) return;
  const expired = await rows<{ id: string; object_key: string }>(pool,
    "SELECT id, object_key FROM assets WHERE expires_at <= now() AND NOT object_removed ORDER BY expires_at LIMIT 200");
  for (const asset of expired) {
    try {
      await deleteObject(asset.object_key);
    } catch (error) {
      if (error instanceof StorageUnavailable) return;
      throw error;
    }
    await pool.query("UPDATE assets SET object_removed = true WHERE id = $1", [asset.id]);
  }
}

const topups = loop("top-up retry", TOPUP_RETRY_MS, retryTopups);
const sweeper = loop("retention sweep", SWEEP_MS, sweep);

export function startUpkeep(): void {
  topups.start();
  sweeper.start();
}

/** Billing came back: retry pending top-ups now. */
export const nudgeTopups = topups.nudge;
