import { query } from '../db/pool.js';
import { config } from '../config.js';
import { sendMail } from './mail.js';

/**
 * Each message is queued once under its dedupe key, so an idempotent replay
 * never sends a second email, and a message that can't be sent is retried on
 * the queue retry schedule.
 */
export async function enqueueMail(
  dedupeKey: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const inserted = await query<{ id: number }>(
    `INSERT INTO mail_outbox (dedupe_key, to_email, subject, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [dedupeKey, to, subject, body],
  );
  if (inserted.length > 0) await drainOutbox().catch(() => undefined);
}

interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  attempts: number;
}

export async function drainOutbox(): Promise<void> {
  // Claiming moves next_attempt_at out by a lease, so two concurrent drains never send one row twice.
  const due = await query<OutboxRow>(
    `UPDATE mail_outbox SET next_attempt_at = now() + interval '60 seconds'
     WHERE id IN (
       SELECT id FROM mail_outbox
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING id, to_email, subject, body, attempts`,
  );
  due.sort((a, b) => a.id - b.id);
  for (const message of due) {
    try {
      await sendMail(message.to_email, message.subject, message.body);
      await query(`UPDATE mail_outbox SET status = 'sent', attempts = attempts + 1 WHERE id = $1`, [
        message.id,
      ]);
    } catch {
      const delay = config.queueRetrySeconds[message.attempts] ?? null;
      if (delay === null) {
        await query(`UPDATE mail_outbox SET status = 'failed', attempts = attempts + 1 WHERE id = $1`, [
          message.id,
        ]);
      } else {
        await query(
          `UPDATE mail_outbox SET attempts = attempts + 1,
             next_attempt_at = now() + make_interval(secs => $2) WHERE id = $1`,
          [message.id, delay],
        );
      }
    }
  }
}
