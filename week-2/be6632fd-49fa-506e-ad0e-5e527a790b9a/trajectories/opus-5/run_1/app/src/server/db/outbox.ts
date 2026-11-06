import { pool, type Transaction } from './pool.ts';
import { newId } from '../services/crypto.ts';
import { sendMessage } from '../services/mail.ts';
import { renderMessage, type MailPayload } from '../services/messages.ts';

/**
 * Queues one email. A `dedupeKey` makes the queueing itself idempotent, so retries and racing
 * app copies can never queue the same message twice.
 */
export async function queueMail(
  tx: Transaction,
  payload: MailPayload,
  dedupeKey: string | null = null,
  runAtMs = Date.now(),
): Promise<void> {
  await tx.query(
    `insert into outbox (id, kind, dedupe_key, payload, run_at_ms, created_at_ms)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (dedupe_key) do nothing`,
    [newId(), payload.kind, dedupeKey ?? newId(), payload, runAtMs, Date.now()],
  );
}

/** Drops every queued, undelivered email to an address, used when a contact is erased. */
export async function dropQueuedMailTo(tx: Transaction, email: string): Promise<void> {
  await tx.query(
    `delete from outbox where sent_at_ms is null and lower(payload->>'email') = lower($1)`,
    [email],
  );
}

interface PendingRow {
  id: string;
  payload: MailPayload;
}

/** Sends every due message exactly once, even with several app copies running. */
export async function deliverQueuedMail(): Promise<void> {
  const client = await pool.connect();
  try {
    for (;;) {
      await client.query('begin');
      const pending = await client.query<PendingRow>(
        `select id, payload from outbox
         where sent_at_ms is null and run_at_ms <= $1
         order by run_at_ms, created_at_ms
         limit 1
         for update skip locked`,
        [Date.now()],
      );
      const row = pending.rows[0];
      if (row === undefined) {
        await client.query('commit');
        return;
      }
      try {
        await sendMessage(renderMessage(row.payload));
        await client.query('update outbox set sent_at_ms = $2 where id = $1', [row.id, Date.now()]);
        await client.query('commit');
      } catch {
        await client.query(
          'update outbox set attempts = attempts + 1, run_at_ms = $2 where id = $1',
          [row.id, Date.now() + 5_000],
        );
        await client.query('commit');
        return;
      }
    }
  } finally {
    client.release();
  }
}
