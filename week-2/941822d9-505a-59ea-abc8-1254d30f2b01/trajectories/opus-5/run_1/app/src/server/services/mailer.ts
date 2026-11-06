import { withTransaction } from '../db/pool.js';
import { markAttempt, markSent, takeUnsent } from '../data/outbox.js';
import { sendMail } from './smtp.js';

const POLL_INTERVAL_MS = 2000;
const BATCH = 10;

/** The outbox retries until every queued message is delivered. */
export function startMailerLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void (async () => {
      const batch = await withTransaction((client) => takeUnsent(client, BATCH));
      for (const message of batch) {
        try {
          await sendMail({ to: message.to_email, subject: message.subject, body: message.body });
          await withTransaction((client) => markSent(client, message.id));
        } catch {
          await withTransaction((client) => markAttempt(client, message.id));
        }
      }
    })().catch(() => {
      // Mail stays in the outbox and is retried on the next tick.
    });
  }, POLL_INTERVAL_MS);
  timer.unref();
  return timer;
}
