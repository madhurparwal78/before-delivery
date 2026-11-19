import { pool } from './db/pool.js';
import { config } from './config.js';
import { deliverQueuedInvites, LEASE_SECONDS } from './services/delivery.js';
import { attemptRecap } from './recap/pipeline.js';
import { purgeDueFrames } from './workshops/trash.js';
import { tryRefreshMirror } from './billing/mirror.js';
import { deleteObject, ensureBucket, StorageUnavailable } from './services/s3.js';
import { ensureCatalog, BillingUnavailable } from './services/killbill.js';

/**
 * Background work runs on every instance's worker. Each item is claimed under a Postgres
 * lease, so no two instances work on the same item at once, and work an instance cannot
 * finish stays for the next claim.
 */

let catalogReady = false;
let bucketReady = false;

async function ensureProviders(): Promise<void> {
  if (!catalogReady) {
    try {
      await ensureCatalog();
      catalogReady = true;
    } catch (error) {
      if (!(error instanceof BillingUnavailable)) throw error;
    }
  }
  if (!bucketReady) {
    try {
      await ensureBucket();
      bucketReady = true;
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
  }
}

async function refreshBillingMirrors(nowMs: number): Promise<void> {
  const facilitators = await pool.query<{ id: string }>('SELECT id FROM facilitators');
  for (const row of facilitators.rows) await tryRefreshMirror(row.id, nowMs);
}

/** Removes objects whose last reference went while storage was unreachable. */
async function drainImageDeletions(): Promise<void> {
  const claimed = await pool.query<{ image_id: string; object_key: string }>(
    `WITH due AS (
       SELECT image_id FROM image_deletions
        WHERE lease_until IS NULL OR lease_until < now()
        ORDER BY queued_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED
     )
     UPDATE image_deletions d
        SET lease_until = now() + ($1 || ' seconds')::interval, attempts = d.attempts + 1
       WHERE d.image_id IN (SELECT image_id FROM due)
     RETURNING d.image_id, d.object_key`,
    [String(LEASE_SECONDS)],
  );
  for (const row of claimed.rows) {
    try {
      await deleteObject(row.object_key);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        await pool.query('UPDATE image_deletions SET lease_until = NULL WHERE image_id = $1', [row.image_id]);
        continue;
      }
      throw error;
    }
    await pool.query('DELETE FROM image_deletions WHERE image_id = $1', [row.image_id]);
    await pool.query('DELETE FROM images WHERE id = $1', [row.image_id]);
  }
}

/** Keeps attempting queued recaps until each one completes. */
async function drainRecaps(): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    const queued = await pool.query<{ workshop_id: string }>(
      `SELECT workshop_id FROM recaps
        WHERE status = 'queued' AND (lease_until IS NULL OR lease_until < now())
        LIMIT 1`,
    );
    const next = queued.rows[0];
    if (!next) return;
    await attemptRecap(next.workshop_id);
  }
}

async function tick(): Promise<void> {
  const nowMs = Date.now();
  await ensureProviders();
  await deliverQueuedInvites(null);
  await drainRecaps();
  await purgeDueFrames();
  await drainImageDeletions();
  await refreshBillingMirrors(nowMs);
}

export function startWorker(): void {
  const run = (): void => {
    void tick().catch((error: unknown) => {
      process.stderr.write(`Worker tick failed: ${(error as Error).message}\n`);
    });
  };
  run();
  const timer = setInterval(run, config.deliveryRetrySeconds * 1000);
  timer.unref();
}
