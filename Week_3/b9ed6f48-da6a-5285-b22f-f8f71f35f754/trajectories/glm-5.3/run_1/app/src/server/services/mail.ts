import crypto from 'node:crypto';
import type { PgPool } from '../db/pg.ts';
import type { Smtp } from './smtp.ts';

/**
 * Mail queue: every outbound email is written to the database first and then
 * delivered exactly once, even when several instances share the database.
 */
export class MailQueue {
  constructor(private pool: PgPool, private smtp: Smtp) {}

  async enqueue(opts: {
    toEmail: string;
    toName: string;
    subject: string;
    body: string;
    dedupeKey?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO mail_queue (id, to_email, to_name, subject, body, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [crypto.randomUUID(), opts.toEmail, opts.toName, opts.subject, opts.body, opts.dedupeKey ?? crypto.randomUUID()],
    );
  }

  /** Deliver queued messages, marking successes only; called on a timer. */
  async flushWithRetry(): Promise<number> {
    const res = await this.pool.query(
      `SELECT id, to_email, to_name, subject, body FROM mail_queue
       WHERE sent_at IS NULL ORDER BY created_at LIMIT 20`,
    );
    if (!res.rows.length) return 0;
    let delivered = 0;
    for (const row of res.rows) {
      const id = String(row['id']);
      try {
        await this.smtp.send(String(row['to_email']), String(row['subject']), String(row['body']));
        await this.pool.query(`UPDATE mail_queue SET sent_at = now() WHERE id = $1`, [id]);
        delivered++;
      } catch {
        // leave unsent; try again on the next flush
      }
    }
    return delivered;
  }
}
