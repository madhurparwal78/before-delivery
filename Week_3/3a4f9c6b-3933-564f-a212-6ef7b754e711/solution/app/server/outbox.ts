// Background work of every instance: reachability checks, draining the queued uploads and notices
// (claimed with FOR UPDATE SKIP LOCKED so each is delivered once across instances) and the expiry sweep.
import type { ServiceStatus } from "../shared/api.js";
import { pool, withTx } from "./db.js";
import { evidenceKey } from "./domain/evidence.js";
import { LAPSING_STATES, expireIfLapsed } from "./domain/promotions.js";
import { lockPromotion } from "./domain/records.js";
import { mailReachable, sendMail } from "./mail.js";
import { putObject, storageReachable } from "./storage.js";

const reachable = { storage: false, mail: false };

export async function serviceStatus(): Promise<ServiceStatus> {
  const { rows } = await pool.query<{ uploads: number; notices: number }>(
    `SELECT (SELECT count(*) FROM evidence_snapshots WHERE stored_at IS NULL)::int
          + (SELECT count(*) FROM bundles WHERE stored_at IS NULL)::int AS uploads,
            (SELECT count(*) FROM messages WHERE sent_at IS NULL)::int AS notices`);
  const counts = rows[0] as { uploads: number; notices: number };
  return {
    storage: reachable.storage ? "up" : "down",
    mail: reachable.mail ? "up" : "down",
    queued_uploads: counts.uploads,
    queued_notices: counts.notices,
  };
}

/** Delivers one claimed item; answers false when the item is gone or the delivery failed. */
async function deliverOne(claim: string, params: unknown[], deliver: (row: Record<string, unknown>) => Promise<void>, done: string): Promise<boolean> {
  try {
    return await withTx(async (tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(claim, params);
      const row = rows[0];
      if (!row) return true;
      await deliver(row);
      await tx.query(done, params);
      return true;
    });
  } catch {
    return false;
  }
}

async function drainUploads(): Promise<void> {
  const snapshots = await pool.query<{ promotion_id: string; number: number }>(
    `SELECT promotion_id, number FROM evidence_snapshots s WHERE stored_at IS NULL
        AND number = (SELECT min(number) FROM evidence_snapshots e WHERE e.promotion_id = s.promotion_id AND e.stored_at IS NULL)
      ORDER BY created_at LIMIT 100`);
  for (const { promotion_id, number } of snapshots.rows) {
    const ok = await deliverOne(
      `SELECT s.body, p.slug FROM evidence_snapshots s JOIN promotions x ON x.id = s.promotion_id JOIN projects p ON p.id = x.project_id
        WHERE s.promotion_id = $1 AND s.number = $2 AND s.stored_at IS NULL FOR UPDATE OF s SKIP LOCKED`,
      [promotion_id, number],
      (row) => putObject(evidenceKey(String(row.slug), promotion_id, number), row.body as Buffer, "Evidence storage is unreachable."),
      "UPDATE evidence_snapshots SET stored_at = now() WHERE promotion_id = $1 AND number = $2");
    if (!ok) return;
  }
  const bundles = await pool.query<{ id: string }>("SELECT id FROM bundles WHERE stored_at IS NULL ORDER BY ingested_at LIMIT 100");
  for (const { id } of bundles.rows) {
    const ok = await deliverOne(
      `SELECT b.object, b.digest, p.slug FROM bundles b JOIN projects p ON p.id = b.project_id
        WHERE b.id = $1 AND b.stored_at IS NULL FOR UPDATE OF b SKIP LOCKED`,
      [id],
      (row) => putObject(`bundles/${String(row.slug)}/${String(row.digest).slice("sha256:".length)}.json`, row.object as Buffer, "Evidence storage is unreachable."),
      "UPDATE bundles SET stored_at = now() WHERE id = $1");
    if (!ok) return;
  }
}

async function drainNotices(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM messages m WHERE sent_at IS NULL
        AND id = (SELECT min(id) FROM messages x WHERE x.promotion_id = m.promotion_id AND x.sent_at IS NULL)
      ORDER BY id LIMIT 100`);
  for (const { id } of rows) {
    const ok = await deliverOne(
      "SELECT recipient, subject, body FROM messages WHERE id = $1 AND sent_at IS NULL FOR UPDATE SKIP LOCKED",
      [id],
      (row) => sendMail(String(row.recipient), String(row.subject), String(row.body)),
      "UPDATE messages SET sent_at = now() WHERE id = $1");
    if (!ok) return;
  }
}

async function sweep(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM promotions WHERE state = ANY($1)", [LAPSING_STATES]);
  for (const { id } of rows) {
    await withTx(async (tx) => {
      const { rows: free } = await tx.query("SELECT id FROM promotions WHERE id = $1 FOR UPDATE SKIP LOCKED", [id]);
      if (free.length) await expireIfLapsed(tx, await lockPromotion(tx, id), new Date());
    });
  }
}

function every(ms: number, task: () => Promise<void>): void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    task().catch((error: Error) => console.error("background task failed:", error.message)).finally(() => { running = false; });
  };
  tick();
  setInterval(tick, ms);
}

export function startWorkers(): void {
  every(2_000, async () => {
    [reachable.storage, reachable.mail] = await Promise.all([storageReachable(), mailReachable()]);
  });
  every(1_000, async () => {
    if (reachable.storage) await drainUploads();
    if (reachable.mail) await drainNotices();
  });
  every(1_000, sweep);
}
