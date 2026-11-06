import nodemailer from 'nodemailer';
import { config } from './config.js';
import { rows, query } from './db.js';
import { utcStamp } from '../shared/format.js';

const transport = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: false,
  ignoreTLS: true,
});

/** Queues a message in Postgres; the mail worker delivers it. */
export async function queueMail(to: string, subject: string, body: string): Promise<void> {
  await query(`INSERT INTO email_outbox (to_addr, subject, body) VALUES ($1,$2,$3)`, [to, subject, body]);
}

/** Retries queued messages every 30 seconds; the action that queued is unaffected. */
export async function runMailWorker(): Promise<void> {
  const outbox = await rows<{ id: string; to_addr: string; subject: string; body: string }>(
    `SELECT id::text AS id, to_addr, subject, body FROM email_outbox ORDER BY id ASC LIMIT 50`
  );
  for (const m of outbox) {
    try {
      await transport.sendMail({
        from: config.mail.from,
        to: m.to_addr,
        subject: m.subject,
        text: m.body,
      });
      await query(`DELETE FROM email_outbox WHERE id = $1`, [m.id]);
    } catch {
      // stays queued; retried next cycle
    }
  }
}

export function fmtBytes(n: number | string): string {
  return Number(n).toLocaleString('en-US') + ' bytes';
}

export function mailTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return utcStamp(date);
}
