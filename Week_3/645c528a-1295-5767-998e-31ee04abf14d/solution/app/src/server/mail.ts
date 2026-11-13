/** Mailpit boundary: a real SMTP conversation, and an outbox in Postgres for whatever the server could not hand over. */
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { config } from './config';
import { query, type Db } from './db';
import { notifyPlayer } from './realtime';

const SMTP_TIMEOUT_MS = 4000;
const CRLF = '\r\n';

type MailKind = 'verification' | 'receipt';

interface OutboxRow {
  id: string;
  player_id: string;
  kind: MailKind;
  recipient: string;
  subject: string;
  body: string;
}

function envelopeAddress(value: string): string {
  return /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
}

function smtpSend(to: string, subject: string, text: string): Promise<void> {
  const from = envelopeAddress(config.smtp.from);
  const message = [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@longrail.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    ...text.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
    '.',
    '',
  ].join(CRLF);
  const script = ['EHLO longrail.example', `MAIL FROM:<${from}>`, `RCPT TO:<${to}>`, 'DATA', message, 'QUIT'];

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    let pending = '';
    let accepted = false;
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error('SMTP timed out')));
    socket.on('error', reject);
    socket.on('close', () => (accepted ? resolve() : reject(new Error('SMTP closed early'))));
    socket.on('data', (data) => {
      pending += data.toString('utf8');
      const lines = pending.split(CRLF);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line[3] === '-') continue;
        if (Number(line.slice(0, 3)) >= 400) {
          socket.destroy(new Error(line));
          return;
        }
        if (script.length === 1) accepted = true;
        const next = script.shift();
        if (next === undefined) socket.end();
        else socket.write(next.endsWith(CRLF) ? next : next + CRLF);
      }
    });
  });
}

export async function enqueueMail(client: Db, playerId: string, kind: MailKind, recipient: string, subject: string, body: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    'INSERT INTO mail_outbox (id, player_id, kind, recipient, subject, body) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, playerId, kind, recipient, subject, body],
  );
  return id;
}

async function deliver(row: OutboxRow): Promise<boolean> {
  try {
    await smtpSend(row.recipient, row.subject, row.body);
  } catch {
    await query('UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    if (row.kind === 'verification') notifyPlayer(row.player_id);
    return false;
  }
  await query('UPDATE mail_outbox SET delivered_at = now() WHERE id = $1', [row.id]);
  if (row.kind === 'verification') notifyPlayer(row.player_id);
  return true;
}

/** True only once the mail server accepted the message. */
export async function deliverNow(id: string): Promise<boolean> {
  const rows = await query<OutboxRow>('SELECT id, player_id, kind, recipient, subject, body FROM mail_outbox WHERE id = $1 AND delivered_at IS NULL', [id]);
  return rows.length === 1 && deliver(rows[0]);
}

export async function retryOutbox(): Promise<void> {
  const rows = await query<OutboxRow>('SELECT id, player_id, kind, recipient, subject, body FROM mail_outbox WHERE delivered_at IS NULL AND attempts > 0');
  for (const row of rows) await deliver(row);
}

/** Sends inside the caller's transaction; a refused or unreachable server leaves the message in the outbox for the retry loop. */
export async function sendOrQueue(client: Db, playerId: string, kind: MailKind, recipient: string, subject: string, body: string): Promise<boolean> {
  try {
    await smtpSend(recipient, subject, body);
    return true;
  } catch {
    const id = await enqueueMail(client, playerId, kind, recipient, subject, body);
    await client.query('UPDATE mail_outbox SET attempts = 1 WHERE id = $1', [id]);
    return false;
  }
}

export function smtpReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(2000, () => socket.destroy());
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('close', () => resolve(false));
  });
}
