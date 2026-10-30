import { config } from '../config.js';
import { query } from '../db/pool.js';
import type { Transaction } from '../db/pool.js';
import { sendMail } from './smtp.js';

export interface OutboundEmail {
  eventKey: string;
  to: string;
  subject: string;
  body: string;
}

/** Queues one email per event; a replayed action never queues a second copy. */
export async function enqueueEmails(tx: Transaction, emails: readonly OutboundEmail[]): Promise<void> {
  for (const email of emails) {
    await tx.query(
      `insert into email_outbox (event_key, to_email, subject, body)
       values ($1, $2, $3, $4) on conflict (event_key) do nothing`,
      [email.eventKey, email.to, email.subject, email.body],
    );
  }
}

interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body: string;
}

export async function flushOutbox(): Promise<void> {
  const rows = await query<OutboxRow>(
    'select id, to_email, subject, body from email_outbox where sent_at is null order by id limit 50',
  );
  for (const row of rows) {
    await sendMail(config.smtp.host, config.smtp.port, {
      from: config.smtp.from,
      to: row.to_email,
      subject: row.subject,
      text: row.body,
    });
    await query('update email_outbox set sent_at = now() where id = $1', [row.id]);
  }
}
