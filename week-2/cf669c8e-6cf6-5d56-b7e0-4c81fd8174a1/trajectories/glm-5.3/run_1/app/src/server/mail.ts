import type { Config } from './config.js';
import { query } from './db.js';


// Mail records: every mail is claimed in PostgreSQL before sending, so
// instances sharing a database send each mail exactly once.

export interface MailRecord {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
}

export async function queueMail(config: Config, record: MailRecord): Promise<void> {
  await query(
    config,
    `insert into mails (id, kind, subject, body, to_email, status) values ($1, $2, $3, $4, $5, 'pending') on conflict do nothing`,
    [record.id, record.subject, record.subject, record.body, record.toEmail],
  );
}

// Record that a fact has been reported. Returns true only for the instance
// that first recorded it, so the mail is drafted once.
export async function recordMailFact(config: Config, factKey: string): Promise<boolean> {
  const r = await query(
    config,
    `insert into mail_facts (fact_key) values ($1) on conflict (fact_key) do nothing`,
    [factKey],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function mailFactExists(config: Config, factKey: string): Promise<boolean> {
  const r = await query(config, 'select 1 from mail_facts where fact_key = $1', [factKey]);
  return r.rows.length > 0;
}

export interface PendingMail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

// Claim one pending mail for sending. Row-level claim via status transition.
export async function claimPendingMail(config: Config): Promise<PendingMail | null> {
  const r = await query<PendingMail>(
    config,
    `update mails set status = 'sending', attempts = attempts + 1
     where id = (select id from mails where status = 'pending' order by created_at limit 1 for update skip locked)
     returning id, to_email, subject, body`,
  );
  return r.rows[0] ?? null;
}

export async function markMailSent(config: Config, id: string): Promise<void> {
  await query(config, `update mails set status = 'sent' where id = $1`, [id]);
}

export async function markMailRetry(config: Config, id: string): Promise<void> {
  await query(config, `update mails set status = 'pending' where id = $1`, [id]);
}
