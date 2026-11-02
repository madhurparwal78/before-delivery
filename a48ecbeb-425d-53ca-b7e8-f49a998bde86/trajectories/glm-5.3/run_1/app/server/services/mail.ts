import { pool } from '../db.js';
import { env } from '../env.js';
import { sendMail } from './smtp.js';

export interface OutboxEmail {
  id: number;
  to_address: string;
  subject: string;
  body_text: string;
}

export async function queueEmail(to: string, subject: string, bodyText: string): Promise<void> {
  await pool.query(
    'insert into email_outbox (to_address, subject, body_text) values ($1, $2, $3)',
    [to, subject, bodyText]
  );
}

export async function flushOutbox(): Promise<void> {
  const { rows } = await pool.query<OutboxEmail>(
    "select id, to_address, subject, body_text from email_outbox where status = 'queued' order by id limit 50"
  );
  for (const email of rows) {
    let ok = false;
    try {
      await sendMail({ from: env.mailFrom, to: email.to_address, subject: email.subject, text: email.body_text });
      ok = true;
    } catch {
      ok = false;
    }
    if (ok) {
      await pool.query("update email_outbox set status = 'sent', sent_at = now() where id = $1", [email.id]);
    }
  }
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${frac}`;
}
