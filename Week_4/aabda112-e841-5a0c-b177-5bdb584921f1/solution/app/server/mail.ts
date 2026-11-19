import nodemailer from 'nodemailer';
import { config } from './config.js';
import { type Db, pool, rows } from './db.js';

/** The one Mailpit client. Mail is written to the outbox with the effect that caused it, then delivered here. */
const transport = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 3000,
  greetingTimeout: 3000,
  socketTimeout: 8000,
});

interface Mail {
  to: string;
  subject: string;
  body: string;
  vaccinationId?: string;
}

export async function enqueueMail(db: Db, mail: Mail): Promise<void> {
  await db.query('INSERT INTO mail_outbox (to_addr, subject, body, vaccination_id) VALUES ($1, $2, $3, $4)', [
    mail.to,
    mail.subject,
    mail.body,
    mail.vaccinationId ?? null,
  ]);
}

let flushing = false;

/** Sends every due message; a failure is retried five seconds later and never reaches the request that caused it. */
export async function flushMail(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const [next] = await rows<{ seq: number; to_addr: string; subject: string; body: string; vaccination_id: string | null }>(
          client,
          `SELECT seq, to_addr, subject, body, vaccination_id FROM mail_outbox
            WHERE sent_at IS NULL AND next_attempt_at <= clock_timestamp()
            ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        if (!next) {
          await client.query('COMMIT');
          return;
        }
        try {
          await transport.sendMail({ from: config.mailFrom, to: next.to_addr, subject: next.subject, text: next.body });
          await client.query('UPDATE mail_outbox SET sent_at = clock_timestamp() WHERE seq = $1', [next.seq]);
          if (next.vaccination_id) {
            await client.query(`UPDATE vaccinations SET reminder = 'Sent' WHERE id = $1`, [next.vaccination_id]);
          }
        } catch {
          await client.query(`UPDATE mail_outbox SET next_attempt_at = clock_timestamp() + interval '5 seconds' WHERE seq = $1`, [next.seq]);
        }
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        return;
      } finally {
        client.release();
      }
    }
  } finally {
    flushing = false;
  }
}
