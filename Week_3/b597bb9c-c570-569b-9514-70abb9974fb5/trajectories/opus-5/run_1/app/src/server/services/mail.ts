/**
 * SMTP. Every message enters the outbox as waiting, is retried every
 * OUTBOX_RETRY_SECONDS, and is marked sent the moment SMTP accepts it.
 */
import { config } from '../config.js';
import { query } from '../db.js';
import { randomId } from '../ids.js';
import { probeSmtp, sendMail } from './smtp.js';

let mailUp = true;

export function mailIsUp(): boolean {
  return mailUp;
}

export async function waitingCount(): Promise<number> {
  const rows = await query<{ count: number }>(`select count(*)::int as count from outbox where state = 'waiting'`);
  return rows[0]?.count ?? 0;
}

export async function enqueueMail(to: string, subject: string, body: string): Promise<string> {
  const id = randomId('mail');
  await query(`insert into outbox (id, to_addr, subject, body, state) values ($1, $2, $3, $4, 'waiting')`, [
    id,
    to,
    subject,
    body,
  ]);
  return id;
}

interface OutboxRow {
  id: string;
  to_addr: string;
  subject: string;
  body: string;
  attempts: number;
}

export async function flushOutbox(): Promise<void> {
  const waiting = await query<OutboxRow>(
    `select id, to_addr, subject, body, attempts from outbox where state = 'waiting' order by created_at limit 20`,
  );
  if (waiting.length === 0) return;
  for (const message of waiting) {
    try {
      await sendMail(config.smtp.host, config.smtp.port, {
        from: config.smtp.from,
        to: message.to_addr,
        subject: message.subject,
        text: message.body,
      });
      await query(`update outbox set state = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1 and state = 'waiting'`, [
        message.id,
      ]);
      mailUp = true;
    } catch {
      mailUp = false;
      await query(`update outbox set attempts = attempts + 1 where id = $1`, [message.id]);
      return;
    }
  }
}

export async function probeMail(): Promise<boolean> {
  mailUp = await probeSmtp(config.smtp.host, config.smtp.port);
  return mailUp;
}
