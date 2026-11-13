import type { StatusResponse } from '../../shared/types.js';
import { pool, query, queryOne, type Tx } from '../db.js';
import { MailUnreachable, mailReachable, sendNotice } from './mail.js';
import { StorageUnreachable, putObject, storageReachable } from './storage.js';

const CLAIM_TIMEOUT = "interval '20 seconds'";

export interface QueuedObject {
  objectKey: string;
  body: Buffer;
  promotionId: string | null;
  snapshotNumber: number | null;
  stored: boolean;
}

/** Records an object that belongs in storage. Pending rows are the queue the ledger strip counts. */
export async function recordObject(tx: Tx, item: QueuedObject): Promise<void> {
  await tx.query(
    `INSERT INTO object_uploads (object_key, body, promotion_id, snapshot_number, stored, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (object_key) DO NOTHING`,
    [item.objectKey, item.body, item.promotionId, item.snapshotNumber, item.stored],
  );
}

export interface QueuedNotice {
  recipient: string;
  subject: string;
  body: string;
  dedupeKey: string;
  promotionId: string | null;
}

/** Queues one message. The dedupe key makes an event's notice arrive exactly once per recipient. */
export async function recordNotice(tx: Tx, notice: QueuedNotice): Promise<void> {
  await tx.query(
    `INSERT INTO mail_queue (recipient, subject, body, dedupe_key, promotion_id, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [notice.recipient, notice.subject, notice.body, notice.dedupeKey, notice.promotionId],
  );
}

export async function nextSnapshotNumber(tx: Tx, promotionId: string): Promise<number> {
  const row = await tx.queryOne<{ next: number }>(
    `SELECT coalesce(max(snapshot_number), 0) + 1 AS next FROM object_uploads
     WHERE promotion_id = $1 AND snapshot_number IS NOT NULL`,
    [promotionId],
  );
  return row?.next ?? 1;
}

export async function latestStoredSnapshot(
  promotionId: string,
): Promise<{ object_key: string; snapshot_number: number } | null> {
  return queryOne(
    `SELECT object_key, snapshot_number FROM object_uploads
     WHERE promotion_id = $1 AND snapshot_number IS NOT NULL AND stored
     ORDER BY snapshot_number DESC LIMIT 1`,
    [promotionId],
  );
}

export async function firstSnapshotStored(tx: Tx, promotionId: string): Promise<boolean> {
  const row = await tx.queryOne<{ stored: boolean }>(
    `SELECT stored FROM object_uploads
     WHERE promotion_id = $1 AND snapshot_number = 1`,
    [promotionId],
  );
  return row?.stored === true;
}

interface PendingUpload {
  id: number;
  object_key: string;
  body: Buffer;
}

async function drainObjects(): Promise<void> {
  for (;;) {
    const claimed = await queryOne<PendingUpload>(
      `UPDATE object_uploads SET claimed_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM object_uploads
         WHERE NOT stored AND (claimed_at IS NULL OR claimed_at < now() - ${CLAIM_TIMEOUT})
         ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, object_key, body`,
    );
    if (!claimed) return;
    try {
      await putObject(claimed.object_key, claimed.body);
      await query('UPDATE object_uploads SET stored = true, claimed_at = NULL WHERE id = $1', [claimed.id]);
    } catch (cause) {
      await query('UPDATE object_uploads SET claimed_at = NULL WHERE id = $1', [claimed.id]);
      if (cause instanceof StorageUnreachable) return;
      throw cause;
    }
  }
}

interface PendingNotice {
  id: number;
  recipient: string;
  subject: string;
  body: string;
}

async function drainNotices(): Promise<void> {
  for (;;) {
    const claimed = await queryOne<PendingNotice>(
      `UPDATE mail_queue SET claimed_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM mail_queue
         WHERE NOT sent AND (claimed_at IS NULL OR claimed_at < now() - ${CLAIM_TIMEOUT})
         ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, recipient, subject, body`,
    );
    if (!claimed) return;
    try {
      await sendNotice(claimed);
      await query('UPDATE mail_queue SET sent = true, claimed_at = NULL WHERE id = $1', [claimed.id]);
    } catch (cause) {
      await query('UPDATE mail_queue SET claimed_at = NULL WHERE id = $1', [claimed.id]);
      if (cause instanceof MailUnreachable) return;
      throw cause;
    }
  }
}

export async function readStatus(): Promise<StatusResponse> {
  const row = await queryOne<{
    storage_up: boolean;
    mail_up: boolean;
    queued_uploads: number;
    queued_notices: number;
  }>(
    `SELECT
       coalesce((SELECT storage_up FROM service_status), false) AS storage_up,
       coalesce((SELECT mail_up FROM service_status), false) AS mail_up,
       (SELECT count(*) FROM object_uploads WHERE NOT stored) AS queued_uploads,
       (SELECT count(*) FROM mail_queue WHERE NOT sent) AS queued_notices`,
  );
  return {
    storage: row?.storage_up ? 'up' : 'down',
    mail: row?.mail_up ? 'up' : 'down',
    queued_uploads: row?.queued_uploads ?? 0,
    queued_notices: row?.queued_notices ?? 0,
  };
}

async function refreshReachability(): Promise<void> {
  const [storage, mail] = await Promise.all([storageReachable(), mailReachable()]);
  await query(
    `INSERT INTO service_status (only_row, storage_up, mail_up, checked_at)
     VALUES (true, $1, $2, now())
     ON CONFLICT (only_row) DO UPDATE
       SET storage_up = $1, mail_up = $2, checked_at = now()`,
    [storage, mail],
  );
}

/**
 * Watches both services and drains whatever is waiting. Every queued item is delivered once,
 * without a restart, as soon as its service answers again.
 */
export function startDeliveryWorker(intervalMs = 3000): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await refreshReachability();
      await drainObjects();
      await drainNotices();
    } catch (cause) {
      process.stderr.write(`delivery worker: ${String(cause)}\n`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs).unref();
  pool.on('error', () => undefined);
}
