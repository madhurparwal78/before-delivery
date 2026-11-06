import crypto from 'node:crypto';
import { query, type Transaction } from './pool.js';

export interface QueuedMail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

export interface MailToQueue {
  /** Identifies the message, so an event never queues two copies. */
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
}

/** Every email first goes into the outbox, so a mail outage never fails a request. */
export async function queueMail(mail: MailToQueue): Promise<void> {
  await query(
    `insert into outbox (id, dedupe_key, to_email, subject, body)
     values ($1, $2, $3, $4, $5)
     on conflict (dedupe_key) do nothing`,
    [crypto.randomUUID(), mail.dedupeKey, mail.to, mail.subject, mail.body],
  );
}

export async function queueMailIn(tx: Transaction, mail: MailToQueue): Promise<void> {
  await tx.execute(
    `insert into outbox (id, dedupe_key, to_email, subject, body)
     values ($1, $2, $3, $4, $5)
     on conflict (dedupe_key) do nothing`,
    [crypto.randomUUID(), mail.dedupeKey, mail.to, mail.subject, mail.body],
  );
}

/** Claims unsent messages, so each is sent exactly once across all processes. */
export async function claimOutbox(limit: number): Promise<QueuedMail[]> {
  return query<QueuedMail>(
    `update outbox set claimed_at = now()
      where id in (
        select id from outbox
         where sent_at is null
           and (claimed_at is null or claimed_at < now() - interval '20 seconds')
         order by queued_at
         limit $1
         for update skip locked
      )
      returning id, to_email, subject, body`,
    [limit],
  );
}

export async function markMailSent(id: string): Promise<void> {
  await query('update outbox set sent_at = now() where id = $1', [id]);
}

export async function releaseMailClaim(id: string): Promise<void> {
  await query('update outbox set claimed_at = null where id = $1', [id]);
}
