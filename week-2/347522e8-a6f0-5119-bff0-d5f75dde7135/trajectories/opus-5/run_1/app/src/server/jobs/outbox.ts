/**
 * The outbox sender. It leases a queued notification, counts the attempt and
 * delivers it; while mail is unreachable the lease lapses and it is retried
 * every `OUTBOX_RETRY_SECONDS`.
 */

import { config } from '../config.js';
import { db } from '../db.js';
import { sendMail } from '../services/smtp.js';

const POLL_INTERVAL_MS = 1_000;
const BATCH = 5;

interface LeasedNotification {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Claims due notifications atomically, so no copy of the app can send one twice. */
async function lease(): Promise<LeasedNotification[]> {
  return db.query<LeasedNotification>(
    `UPDATE notifications
        SET attempts = attempts + 1,
            next_attempt_at = now() + make_interval(secs => $1::double precision)
      WHERE id IN (
        SELECT id FROM notifications
         WHERE status = 'queued' AND next_attempt_at <= now()
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, to_email, subject, body`,
    [config.outboxRetrySeconds, BATCH],
  );
}

async function deliver(notification: LeasedNotification): Promise<void> {
  await sendMail({
    to: notification.to_email,
    subject: notification.subject,
    body: notification.body,
  });
  await db.query(
    `UPDATE notifications SET status = 'sent', sent_at = now()
      WHERE id = $1 AND status = 'queued'`,
    [notification.id],
  );
}

export function startOutboxSender(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const notification of await lease()) {
        try {
          await deliver(notification);
        } catch {
          // Mail is unreachable: the lease lapses and the retry counts again.
        }
      }
    } catch (error: unknown) {
      process.stderr.write(`outbox sender failed: ${String(error)}\n`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS).unref();
}
