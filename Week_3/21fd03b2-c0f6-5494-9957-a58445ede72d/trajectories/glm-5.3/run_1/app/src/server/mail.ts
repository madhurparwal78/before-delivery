import nodemailer from 'nodemailer';
import type { DbClient } from './db';
import { randomId } from './crypto';

const host = process.env.SMTP_HOST ?? '127.0.0.1';
const port = Number(process.env.SMTP_PORT ?? 1025);
const from = process.env.MAIL_FROM ?? 'Rampwright <bench@tarnandtally.example>';

export type MailKind = 'invite' | 'role_change' | 'share' | 'publish';

export type MailMessage = {
  to: string;
  subject: string;
  body: string;
  kind: MailKind;
  refId: string | null;
};

let transporter: nodemailer.Transporter | null = null;

function mailer(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 4000,
    });
  }
  return transporter;
}

export async function queueMail(client: DbClient, message: MailMessage): Promise<string> {
  const id = randomId('mail');
  await client.query(
    'INSERT INTO mail_outbox (id, to_email, subject, body, kind, ref_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, message.to, message.subject, message.body, message.kind, message.refId],
  );
  return id;
}

export async function sendNow(client: DbClient, id: string): Promise<boolean> {
  const row = await client.query('SELECT * FROM mail_outbox WHERE id = $1 AND sent_at IS NULL FOR UPDATE', [id]);
  const msg = row.rows[0];
  if (!msg) return true;
  if (await messageStillLive(client, msg.kind, msg.ref_id)) {
    try {
      await mailer().sendMail({ from, to: msg.to_email, subject: msg.subject, text: msg.body });
    } catch {
      return false;
    }
  }
  await client.query('UPDATE mail_outbox SET sent_at = now() WHERE id = $1', [id]);
  return true;
}

async function messageStillLive(client: DbClient, kind: string, refId: string | null): Promise<boolean> {
  if (!refId) return true;
  if (kind === 'invite') {
    const row = await client.query('SELECT status FROM invites WHERE id = $1', [refId]);
    return row.rows[0]?.status === 'pending';
  }
  if (kind === 'share') {
    const row = await client.query('SELECT status, expires_at FROM share_links WHERE id = $1', [refId]);
    const link = row.rows[0];
    if (!link || link.status !== 'active') return false;
    return new Date(link.expires_at).getTime() > Date.now();
  }
  return true;
}

export async function deliverPending(client: DbClient): Promise<void> {
  // Deliver queued messages in queue order, exactly once per message.
  const rows = await client.query(
    'SELECT id FROM mail_outbox WHERE sent_at IS NULL ORDER BY seq ASC LIMIT 20',
  );
  for (const row of rows.rows) {
    // Try to mark in-flight atomically: only one worker picks each message.
    await sendNow(client, row.id);
  }
}

export async function mailStatus(): Promise<'ok' | 'down'> {
  try {
    await mailer().verify();
    return 'ok';
  } catch {
    return 'down';
  }
}

export function mailFrom(): string {
  return from;
}
