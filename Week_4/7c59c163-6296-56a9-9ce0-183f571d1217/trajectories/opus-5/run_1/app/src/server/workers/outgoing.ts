import { inTransaction } from '../db/pool.js';
import { sendMail } from '../providers/smtp.js';
import { sendMessage } from '../providers/svix.js';
import type { EmailMessage, WebhookMessage } from '../domain/queue.js';

const CLAIM_BATCH = 20;
const POLL_MS = 1000;
const EMAIL_RETRY_MS = 10_000;
const WEBHOOK_MIN_RETRY_MS = 5_000;
const WEBHOOK_MAX_RETRY_MS = 60_000;

interface QueueRow {
  id: string;
  kind: 'email' | 'webhook';
  payload: EmailMessage | WebhookMessage;
  attempts: number;
}

/** Emails are retried every 10 seconds; webhook messages every 5 to 60 seconds, doubling each time. */
function retryDelayMs(kind: QueueRow['kind'], attempts: number): number {
  if (kind === 'email') return EMAIL_RETRY_MS;
  return Math.min(WEBHOOK_MIN_RETRY_MS * 2 ** Math.max(attempts - 1, 0), WEBHOOK_MAX_RETRY_MS);
}

async function deliver(row: QueueRow): Promise<void> {
  if (row.kind === 'email') {
    await sendMail(row.payload as EmailMessage);
    return;
  }
  const message = row.payload as WebhookMessage;
  await sendMessage(
    message.venue_slug,
    message.member_id,
    message.event_type,
    message.event_id,
    message.payload,
  );
}

/** Workers in every instance claim queue rows without blocking one another. */
async function drainOnce(): Promise<number> {
  const claimed = await inTransaction(async (client) => {
    const result = await client.query<QueueRow>(
      `select id, kind, payload, attempts from outgoing_messages
        where delivered_at is null and next_attempt_at <= now()
        order by id limit ${CLAIM_BATCH} for update skip locked`,
    );
    if (result.rowCount === 0) return [];
    await client.query(
      `update outgoing_messages
          set attempts = attempts + 1,
              next_attempt_at = now() + interval '5 minutes'
        where id = any($1::bigint[])`,
      [result.rows.map((row) => row.id)],
    );
    return result.rows;
  });

  for (const row of claimed) {
    try {
      await deliver(row);
      await inTransaction(async (client) => {
        await client.query('update outgoing_messages set delivered_at = now() where id = $1', [row.id]);
      });
    } catch {
      const delay = retryDelayMs(row.kind, row.attempts + 1);
      await inTransaction(async (client) => {
        await client.query(
          `update outgoing_messages set next_attempt_at = now() + ($2 || ' milliseconds')::interval
            where id = $1`,
          [row.id, delay],
        );
      });
    }
  }
  return claimed.length;
}

export function startOutgoingWorker(): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void drainOnce()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
