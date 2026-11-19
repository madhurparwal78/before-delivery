import nodemailer from 'nodemailer';
import { q, one } from './db.js';
import { now } from './clock.js';
import { formatDate } from '../shared/rules.js';

interface OutboxRow { id: string; to_email: string; subject: string; body: string }

let transporter: nodemailer.Transporter | null = null;

function mailer(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false
    });
  }
  return transporter;
}

/** Queue a message; delivery happens from the outbox so a slow or absent
 * mail server never blocks the action and each message goes once. */
export async function queueMail(to: string, subject: string, body: string, key?: string): Promise<void> {
  if (key) {
    const existing = await one<{ id: string }>('select id from mail_outbox where subject = $1 and to_email = $2', [subject, to]);
    if (existing) return;
  }
  await q('insert into mail_outbox (to_email, subject, body, sent, created_at) values ($1, $2, $3, false, $4)',
    [to, subject, body, await now()]);
}

/** Try to send every unsent message once per call; failures stay queued. */
export async function flushOutbox(): Promise<void> {
  const rows = await q<OutboxRow>('select id, to_email, subject, body from mail_outbox where sent = false order by id limit 20');
  for (const row of rows) {
    try {
      await mailer().sendMail({ from: process.env.MAIL_FROM, to: row.to_email, subject: row.subject, text: row.body });
      await q('update mail_outbox set sent = true where id = $1', [row.id]);
    } catch {
      // stays queued; retried next flush
    }
  }
}

export function mentionSubject(sprite: string, frame: number): string {
  return `Mentioned on ${sprite}, frame ${frame}`;
}

export function inviteSubject(project: string): string {
  return `Join ${project} on Celmate`;
}

export function formatForRecipient(instant: string, format: string, zone: string): string {
  return formatDate(instant, format === 'en-IN' ? 'en-IN' : 'en-US', zone as 'UTC' | 'Asia/Kolkata' | 'America/New_York');
}

export function startOutboxLoop(): void {
  const tick = (): void => { void flushOutbox().catch(() => {}); };
  setInterval(tick, 2000);
}
