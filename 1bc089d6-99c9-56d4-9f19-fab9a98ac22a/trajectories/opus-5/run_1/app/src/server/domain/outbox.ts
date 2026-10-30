import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { clientQuery, query, Unavailable } from '../db.js';
import { now } from '../clock.js';
import type { Letter } from './mail.js';
import { sendMail } from './smtp.js';

interface OutboxRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  link_token: string | null;
}

/** Writes an email to the outbox in the same step as the change that causes it. */
export async function enqueue(client: PoolClient, letter: Letter, at: Date): Promise<string> {
  const id = randomUUID();
  await clientQuery(
    client,
    `insert into outbox (id, recipient, subject, body, link_token, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, letter.recipient, letter.subject, letter.body, letter.linkToken, at],
  );
  return id;
}

async function handToMailService(row: OutboxRow): Promise<void> {
  await sendMail({ to: row.recipient, subject: row.subject, text: row.body });
}

async function markSent(row: OutboxRow): Promise<void> {
  const at = await now();
  await query('update outbox set sent_at = $2, claimed_at = null where id = $1', [row.id, at]);
  if (row.link_token) {
    await query('update links set sent_at = $2 where token = $1 and sent_at is null', [row.link_token, at]);
  }
}

async function release(id: string): Promise<void> {
  await query('update outbox set claimed_at = null where id = $1 and sent_at is null', [id]);
}

async function claim(limit: number, onlyId?: string): Promise<OutboxRow[]> {
  const result = await query<OutboxRow>(
    `update outbox set claimed_at = now()
       where id in (
         select id from outbox
          where sent_at is null
            and (claimed_at is null or claimed_at < now() - interval '30 seconds')
            and ($2::uuid is null or id = $2::uuid)
          order by created_at
          limit $1
          for update skip locked
       )
     returning id, recipient, subject, body, link_token`,
    [limit, onlyId ?? null],
  );
  return result.rows;
}

/** Tries to deliver one queued email at once. Answers whether the mail service took it. */
export async function deliverNow(id: string): Promise<boolean> {
  const [row] = await claim(1, id);
  if (!row) return false;
  try {
    await handToMailService(row);
  } catch {
    await release(id);
    return false;
  }
  await markSent(row);
  return true;
}

let flushing = false;

/** Retries every undelivered email, so each one reaches the mail service exactly once. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const rows = await claim(20);
    for (const row of rows) {
      try {
        await handToMailService(row);
      } catch {
        await release(row.id);
        break;
      }
      await markSent(row);
    }
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
  } finally {
    flushing = false;
  }
}
