import { config } from '../config.js';
import { pool, type Queryable } from '../db/pool.js';
import { sendMail } from './smtp.js';

export interface OutboundEmail {
  eventKey: string;
  to: string;
  subject: string;
  body: string;
}

/** Queues an email inside the caller's transaction; a repeated event key queues nothing. */
export async function enqueueEmail(db: Queryable, email: OutboundEmail): Promise<void> {
  await db.query(
    `INSERT INTO outbox (event_key, to_email, subject, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_key) DO NOTHING`,
    [email.eventKey, email.to, email.subject, email.body],
  );
}

export async function flushOutbox(): Promise<void> {
  const pending = await pool.query<{ id: number; to_email: string; subject: string; body: string }>(
    'SELECT id, to_email, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY id ASC LIMIT 200',
  );
  for (const message of pending.rows) {
    await sendMail(config.smtp.host, config.smtp.port, {
      from: config.smtp.from,
      to: message.to_email,
      subject: message.subject,
      text: message.body,
    });
    await pool.query('UPDATE outbox SET sent_at = now() WHERE id = $1', [message.id]);
  }
}
