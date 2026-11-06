import { pool, query, queryOne, type Db } from '../db/pool.js';
import { markMail } from './health.js';
import { sendMail } from './smtp.js';

export interface QueuedEmail {
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
}

/** Queued inside the caller's transaction, so an email is never lost or doubled. */
export async function queueEmail(db: Db, email: QueuedEmail): Promise<void> {
  await db.query(
    `INSERT INTO email_queue (dedupe_key, to_email, subject, body)
     VALUES ($1, $2, $3, $4) ON CONFLICT (dedupe_key) DO NOTHING`,
    [email.dedupeKey, email.to, email.subject, email.body],
  );
}

export async function queuedEmailCount(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    pool,
    `SELECT COUNT(*)::text AS count FROM email_queue WHERE status = 'queued'`,
  );
  return Number(row?.count ?? 0);
}

interface QueueRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  queued_at: Date;
}

export async function drainEmailQueue(): Promise<void> {
  const rows = await query<QueueRow>(
    pool,
    `SELECT id::text, to_email, subject, body, queued_at
       FROM email_queue WHERE status = 'queued' ORDER BY id LIMIT 25`,
  );
  if (rows.length === 0) return;
  for (const row of rows) {
    try {
      await sendMail({
        to: row.to_email,
        subject: row.subject,
        body: row.body,
        queuedAt: row.queued_at,
      });
    } catch {
      markMail(false);
      return;
    }
    await pool.query(
      `UPDATE email_queue SET status = 'sent', sent_at = now() WHERE id = $1::bigint AND status = 'queued'`,
      [row.id],
    );
    markMail(true);
  }
}
