import { query, withTransaction } from '../db/pool.js';
import { sendMail } from '../services/mail.js';

const POLL_INTERVAL_MS = 5_000;

interface QueuedEmail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

async function claimNext(): Promise<QueuedEmail | null> {
  return withTransaction(async (client) => {
    const claimed = await client.query<QueuedEmail>(
      `UPDATE email_queue SET state = 'sending', locked_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM email_queue
         WHERE state = 'queued' OR (state = 'sending' AND locked_at < now() - interval '60 seconds')
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, to_email, subject, body`,
    );
    return claimed.rows[0] ?? null;
  });
}

async function drainQueue(): Promise<void> {
  for (;;) {
    const next = await claimNext();
    if (!next) return;
    try {
      await sendMail(next.to_email, next.subject, next.body);
      await query("UPDATE email_queue SET state = 'sent' WHERE id = $1", [next.id]);
    } catch {
      await query("UPDATE email_queue SET state = 'queued', locked_at = NULL WHERE id = $1", [
        next.id,
      ]);
      return;
    }
  }
}

export function startMailer(): void {
  const tick = (): void => {
    void drainQueue().catch(() => undefined);
  };
  setInterval(tick, POLL_INTERVAL_MS).unref();
  tick();
}
