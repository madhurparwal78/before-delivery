import { Db, queryOne, withTransaction } from '../db/pool';
import { config } from '../env';
import { sendMail } from './smtp';

export const MAIL_FROM_NAME = 'Fernhollow Access Dispatch';
export const MAIL_FROM_ADDRESS = 'dispatch@fernhollow.test';
const MAIL_DOMAIN = 'fernhollow.test';

export interface OutboxMessage {
  dedupeKey: string;
  toEmail: string;
  toName: string;
  subject: string;
  body: string;
}

/** Every email goes into the Postgres outbox first; the worker delivers it exactly once. */
export async function queueEmail(db: Db, message: OutboxMessage): Promise<string> {
  const inserted = await queryOne<{ id: string }>(
    db,
    `insert into outbox (dedupe_key, to_email, to_name, subject, body)
     values ($1, $2, $3, $4, $5)
     on conflict (dedupe_key) do nothing
     returning id`,
    [message.dedupeKey, message.toEmail, message.toName, message.subject, message.body],
  );
  if (inserted) return inserted.id;
  const existing = await queryOne<{ id: string }>(
    db,
    'select id from outbox where dedupe_key = $1',
    [message.dedupeKey],
  );
  if (!existing) throw new Error(`outbox row vanished for ${message.dedupeKey}`);
  return existing.id;
}

interface PendingRow {
  id: string;
  to_email: string;
  to_name: string;
  subject: string;
  body: string;
}

/** Sends one queued message at a time, locked so no two serve instances send the same row. */
export async function deliverQueuedEmails(): Promise<number> {
  let delivered = 0;
  for (let round = 0; round < 20; round += 1) {
    const sent = await withTransaction(async (client) => {
      const next = await queryOne<PendingRow>(
        client,
        `select id, to_email, to_name, subject, body from outbox
         where status = 'queued'
         order by id
         for update skip locked
         limit 1`,
      );
      if (!next) return false;
      const messageId = `<outbox-${next.id}@${MAIL_DOMAIN}>`;
      try {
        await sendMail(config.smtpHost, config.smtpPort, {
          fromName: MAIL_FROM_NAME,
          fromAddress: MAIL_FROM_ADDRESS,
          toName: next.to_name,
          toAddress: next.to_email,
          subject: next.subject,
          text: next.body,
          messageId,
        });
      } catch (error) {
        await client.query(
          `update outbox set attempts = attempts + 1, last_error = $2 where id = $1`,
          [next.id, error instanceof Error ? error.message : 'send failed'],
        );
        return false;
      }
      await client.query(
        `update outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null
         where id = $1`,
        [next.id],
      );
      return true;
    });
    if (!sent) break;
    delivered += 1;
  }
  return delivered;
}

export async function mailReachable(timeoutMs: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.mailpitUrl}/api/v1/info`, { signal: abort.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
