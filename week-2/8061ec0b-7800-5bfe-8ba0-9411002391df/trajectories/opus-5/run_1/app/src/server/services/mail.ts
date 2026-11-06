import { config } from '../config';
import { now } from '../clock';
import { pool, tx } from '../db';
import type { Db } from '../domain/pricing';
import { sendMail } from './smtp';

export interface OutboxMessage {
  dedupeKey: string;
  recipient: string;
  subject: string;
  body: string;
}

/** Queues an email in the same step as the action that caused it. */
export async function queueEmail(sql: Db, message: OutboxMessage): Promise<void> {
  await sql.query(
    `insert into outbox (dedupe_key, recipient, subject, body, created_at)
     values ($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing`,
    [message.dedupeKey, message.recipient, message.subject, message.body, now()],
  );
}

export function origin(): string {
  return config.publicUrl;
}

async function deliverBatch(): Promise<void> {
  const claimed = await tx(async (sql) => {
    const { rows } = await sql.query<{ id: string; recipient: string; subject: string; body: string }>(
      `update outbox set sent_at = $1
         where id in (select id from outbox where sent_at is null order by id limit 5 for update skip locked)
         returning id, recipient, subject, body`,
      [now()],
    );
    return rows;
  });
  for (const message of claimed) {
    try {
      await sendMail({ recipient: message.recipient, subject: message.subject, body: message.body, at: now() });
    } catch {
      await pool.query('update outbox set sent_at = null where id = $1', [message.id]);
    }
  }
}

/** Retries queued email until it is delivered, without ever sending one twice. */
export function startOutboxWorker(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void deliverBatch()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, 1500).unref();
}
