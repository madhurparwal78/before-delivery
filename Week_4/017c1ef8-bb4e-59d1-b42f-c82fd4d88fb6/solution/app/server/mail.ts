import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';
import { now } from './clock.js';
import { rows, type Db, pool } from './db.js';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

const RETRY_SECONDS = 10;
const GIVE_UP_SECONDS = 600;

/** Queues a message in the same transaction as the action that caused it. Delivery never blocks the action. */
export async function queueMail(db: Db, mail: Mail): Promise<void> {
  await db.query('INSERT INTO mail_outbox (to_address, subject, body, queued_at, next_attempt_at) VALUES ($1, $2, $3, $4, $4)', [mail.to, mail.subject, mail.text, now()]);
}

function bareAddress(from: string): string {
  const open = from.indexOf('<');
  return open >= 0 ? from.slice(open + 1, from.indexOf('>')) : from.trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(mail: Mail): string {
  const body = mail.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${now().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${encoded}\r\n.\r\n`;
}

/** Reads one SMTP reply (possibly multi-line) and checks its code. */
function reader(socket: Socket) {
  let buffer = '';
  const waiting: Array<(line: string) => void> = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3}-/.test(line)) continue;
      waiting.shift()?.(line);
    }
  });
  return (expected: string): Promise<void> =>
    new Promise((resolve, reject) => {
      waiting.push((line) => (line.startsWith(expected) ? resolve() : reject(new Error(`SMTP said ${line}`))));
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('SMTP connection closed')));
    });
}

async function deliver(mail: Mail): Promise<void> {
  const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(10_000, () => socket.destroy(new Error('SMTP timeout')));
  const expect = reader(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    await expect('220');
    socket.write('EHLO plainwork\r\n');
    await expect('250');
    socket.write(`MAIL FROM:<${bareAddress(config.smtp.from)}>\r\n`);
    await expect('250');
    socket.write(`RCPT TO:<${mail.to}>\r\n`);
    await expect('250');
    socket.write('DATA\r\n');
    await expect('354');
    socket.write(buildMessage(mail));
    await expect('250');
    socket.write('QUIT\r\n');
  } finally {
    socket.destroy();
  }
}

interface Pending {
  id: number;
  to_address: string;
  subject: string;
  body: string;
  queued_at: Date;
}

let sending = false;

async function sendPending(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    const pending = await rows<Pending>(
      pool,
      'SELECT id, to_address, subject, body, queued_at FROM mail_outbox WHERE sent_at IS NULL AND next_attempt_at <= $1 ORDER BY id LIMIT 20',
      [now()],
    );
    for (const item of pending) {
      try {
        await deliver({ to: item.to_address, subject: item.subject, text: item.body });
        await pool.query('UPDATE mail_outbox SET sent_at = $2 WHERE id = $1', [item.id, now()]);
      } catch {
        const at = now();
        if (at.getTime() - item.queued_at.getTime() > GIVE_UP_SECONDS * 1000) await pool.query('DELETE FROM mail_outbox WHERE id = $1', [item.id]);
        else await pool.query('UPDATE mail_outbox SET next_attempt_at = $2 WHERE id = $1', [item.id, new Date(at.getTime() + RETRY_SECONDS * 1000)]);
      }
    }
  } finally {
    sending = false;
  }
}

export function startMailWorker(): void {
  setInterval(() => void sendPending().catch((error: unknown) => console.error('mail worker failed', error)), 500).unref();
}
