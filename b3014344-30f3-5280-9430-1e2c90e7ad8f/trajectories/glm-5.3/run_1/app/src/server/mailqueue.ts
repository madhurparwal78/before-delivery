import { pool } from './db.js';
import { sendMail, MailError } from './mail.js';

/**
 * One pass of the mail queue: claims undelivered messages and delivers each
 * exactly once. A claim expires so another process retries after a minute.
 */
export async function mailScan(): Promise<void> {
  const client = await pool.connect().catch(() => null);
  if (!client) return;
  try {
    await client.query('BEGIN');
    const rows = await client.query(
      `SELECT id, to_email, subject, body FROM mail_queue
       WHERE delivered_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - interval '45 seconds')
       ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED`,
    );
    const messages = rows.rows as { id: string; to_email: string; subject: string; body: string }[];
    if (messages.length === 0) {
      await client.query('COMMIT');
      return;
    }
    await client.query('UPDATE mail_queue SET claimed_at = now() WHERE id = ANY($1)', [messages.map((m) => m.id)]);
    await client.query('COMMIT');
    for (const message of messages) {
      try {
        await sendMail(message.to_email, message.subject, message.body);
        await pool.query('UPDATE mail_queue SET delivered_at = now() WHERE id = $1', [message.id]);
      } catch (err) {
        if (!(err instanceof MailError) && !(err instanceof Error)) throw err;
        await pool.query('UPDATE mail_queue SET claimed_at = NULL WHERE id = $1', [message.id]).catch(() => undefined);
      }
    }
  } finally {
    client.release();
  }
}

export function startMailWorker(): void {
  void (async () => {
    for (;;) {
      await mailScan().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  })();
}
