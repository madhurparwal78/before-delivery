import { businessNow } from './clock';
import { config } from './config';
import { query } from './db';
import { newId } from './ids';
import { sendMail } from './smtp';

const RETRY_WINDOW_MS = 10 * 60 * 1000;

/** Email sending never blocks the action: it is queued and drained. */
export async function queueMail(to: string, subject: string, body: string): Promise<void> {
  await query(
    'INSERT INTO mail_queue (id, to_addr, subject, body, created_at) VALUES ($1,$2,$3,$4,$5)',
    [newId('mail'), to, subject, body, businessNow()],
  );
  void drainMailQueue();
}

let draining = false;

export async function drainMailQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const pending = await query<{ id: string; to_addr: string; subject: string; body: string }>(
      `SELECT id, to_addr, subject, body FROM mail_queue
       WHERE sent_at IS NULL AND created_at > $1
       ORDER BY created_at LIMIT 25`,
      [new Date(businessNow().getTime() - RETRY_WINDOW_MS)],
    );
    for (const mail of pending) {
      try {
        await sendMail(config.smtp.host, config.smtp.port, {
          from: config.smtp.from,
          to: mail.to_addr,
          subject: mail.subject,
          text: mail.body,
        });
        await query('UPDATE mail_queue SET sent_at = $2 WHERE id = $1', [mail.id, businessNow()]);
      } catch {
        await query('UPDATE mail_queue SET attempts = attempts + 1 WHERE id = $1', [mail.id]);
      }
    }
  } finally {
    draining = false;
  }
}

export function startMailWorker(): void {
  setInterval(() => void drainMailQueue(), 10000).unref();
}
