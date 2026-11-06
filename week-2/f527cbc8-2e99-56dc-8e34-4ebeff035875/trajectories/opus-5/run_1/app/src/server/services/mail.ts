import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withTransaction, type Db } from '../db.js';
import { newId } from '../util.js';
import { log } from '../log.js';
import { sendEmail } from './smtp.js';

/**
 * Emails go through a Postgres outbox, so the action that causes an email always
 * succeeds even when Mailpit is down. A message is request-queued when an incoming
 * request's transaction queues it, and background-queued when the reconciler or a job
 * does. The first attempt of a request-queued message stays with the instance that
 * queued it; a background-queued message can be claimed by any instance.
 */
const FAILED_HOLD_OFF_SECONDS = 20;

export interface QueuedEmail {
  to: string;
  subject: string;
  body: string;
  /** One message per event, even under concurrent or retried requests. */
  dedupeKey: string;
}

export async function queueRequestEmail(db: Db, message: QueuedEmail): Promise<void> {
  const instant = now();
  await query(
    db,
    `INSERT INTO email_outbox (id, to_address, subject, body, queue_kind, status, claimed_by,
                               lease_expires_at, next_attempt_at, first_attempt_pending,
                               dedupe_key, created_at)
     VALUES ($1,$2,$3,$4,'request','queued',$5,$6,$7,true,$8,$9)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      newId(),
      message.to,
      message.subject,
      message.body,
      config.instanceLabel,
      new Date(instant.getTime() + config.jobLeaseSeconds * 1000),
      instant,
      message.dedupeKey,
      instant,
    ],
  );
}

export async function queueBackgroundEmail(db: Db, message: QueuedEmail): Promise<void> {
  const instant = now();
  await query(
    db,
    `INSERT INTO email_outbox (id, to_address, subject, body, queue_kind, status, claimed_by,
                               lease_expires_at, next_attempt_at, first_attempt_pending,
                               dedupe_key, created_at)
     VALUES ($1,$2,$3,$4,'background','queued',NULL,NULL,$5,false,$6,$7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [newId(), message.to, message.subject, message.body, instant, message.dedupeKey, instant],
  );
}

interface OutboxRow {
  id: string;
  to_address: string;
  subject: string;
  body: string;
  queue_kind: 'request' | 'background';
}

/**
 * Claims one sendable message. A request-queued message is claimable by its own
 * instance at once; by others only once its first attempt has failed or its lease has
 * expired with no attempt made. A background-queued message is claimable by anyone,
 * except by the instance whose own send failed inside the last 20 seconds.
 */
async function claimMessage(db: Db, instant: Date): Promise<OutboxRow | null> {
  return await queryOne<OutboxRow>(
    db,
    `UPDATE email_outbox SET claimed_by = $1, lease_expires_at = $2
     WHERE id = (
       SELECT id FROM email_outbox
       WHERE status = 'queued'
         AND next_attempt_at <= $3
         AND (
           claimed_by IS NULL
           OR claimed_by = $1
           OR (lease_expires_at IS NOT NULL AND lease_expires_at <= $3)
         )
         AND NOT (
           queue_kind = 'background'
           AND last_attempt_by = $1
           AND last_attempt_at > $4
         )
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, to_address, subject, body, queue_kind`,
    [
      config.instanceLabel,
      new Date(instant.getTime() + config.jobLeaseSeconds * 1000),
      instant,
      new Date(instant.getTime() - FAILED_HOLD_OFF_SECONDS * 1000),
    ],
  );
}

async function recordSent(db: Db, id: string, instant: Date): Promise<void> {
  await query(
    db,
    `UPDATE email_outbox SET status = 'sent', sent_at = $2, claimed_by = NULL,
                             lease_expires_at = NULL, first_attempt_pending = false
     WHERE id = $1`,
    [id, instant],
  );
}

async function recordFailure(
  db: Db,
  row: OutboxRow,
  instant: Date,
  error: unknown,
): Promise<void> {
  // A request-queued message holds off 20 seconds after a failed send before any
  // instance tries again. A background-queued message is free for other instances at
  // once; only the failing instance waits.
  const nextAttemptAt =
    row.queue_kind === 'request'
      ? new Date(instant.getTime() + FAILED_HOLD_OFF_SECONDS * 1000)
      : instant;
  await query(
    db,
    `UPDATE email_outbox SET attempts = attempts + 1, claimed_by = NULL, lease_expires_at = NULL,
                             first_attempt_pending = false, next_attempt_at = $2,
                             last_error = $3, last_attempt_by = $4, last_attempt_at = $5
     WHERE id = $1`,
    [row.id, nextAttemptAt, String(error).slice(0, 500), config.instanceLabel, instant],
  );
}

/** Sends at most one message; returns true when one was attempted. */
export async function pumpOutboxOnce(): Promise<boolean> {
  const instant = now();
  const claimed = await withTransaction(async (db) => claimMessage(db, instant));
  if (claimed === null) return false;
  try {
    await sendEmail({ to: claimed.to_address, subject: claimed.subject, body: claimed.body });
    await withTransaction((db) => recordSent(db, claimed.id, now()));
  } catch (error) {
    await withTransaction((db) => recordFailure(db, claimed, now(), error));
    log.event({ event: 'email_send_failed', email_id: claimed.id });
  }
  return true;
}

/**
 * On drain, request-queued messages this instance claimed but has not yet attempted are
 * released, so any instance can send them at once.
 */
export async function releaseUnattemptedClaims(db: Db): Promise<void> {
  await query(
    db,
    `UPDATE email_outbox SET claimed_by = NULL, lease_expires_at = NULL, first_attempt_pending = false
     WHERE status = 'queued' AND claimed_by = $1 AND attempts = 0`,
    [config.instanceLabel],
  );
}
