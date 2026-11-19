import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { config } from '../config.js';
import { query } from '../db.js';

interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines.at(-2);
      if (lines.at(-1) === '' && last !== undefined && /^\d{3} /.test(last)) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve(buffer);
      }
    };
    const onError = (error: Error): void => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function addressOnly(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

async function deliver(row: OutboxRow): Promise<void> {
  const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(5000);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('mail timeout')));
    });
    await readReply(socket);
    const step = async (line: string): Promise<string> => {
      socket.write(`${line}\r\n`);
      return readReply(socket);
    };
    await step('EHLO hearthtile');
    await step(`MAIL FROM:<${addressOnly(config.mail.from)}>`);
    await step(`RCPT TO:<${row.to_email}>`);
    await step('DATA');
    const message = [
      `From: ${config.mail.from}`,
      `To: ${row.to_email}`,
      `Subject: ${row.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      row.body
    ].join('\r\n');
    socket.write(`${message.replace(/\r?\n\./g, '\r\n..')}\r\n.\r\n`);
    await readReply(socket);
    await step('QUIT');
  } finally {
    socket.destroy();
  }
}

export async function enqueueMail(to: string, subject: string, body: string): Promise<void> {
  await query('insert into mail_outbox (id, to_email, subject, body) values ($1, $2, $3, $4)', [
    randomUUID(),
    to,
    subject,
    body
  ]);
}

export async function flushOutbox(): Promise<void> {
  const rows = await query<OutboxRow>(
    `update mail_outbox set sent = true, attempts = attempts + 1
       where id in (select id from mail_outbox where sent = false order by created_at limit 20 for update skip locked)
       returning id, to_email, subject, body`
  );
  for (const row of rows) {
    try {
      await deliver(row);
    } catch {
      await query('update mail_outbox set sent = false where id = $1', [row.id]);
    }
  }
}

export function startMailWorker(): void {
  setInterval(() => void flushOutbox(), 1000).unref();
}

export function linkBase(requestOrigin: string | null): string {
  if (config.publicUrl !== '') return config.publicUrl.replace(/\/$/, '');
  return (requestOrigin ?? `http://127.0.0.1:${config.port}`).replace(/\/$/, '');
}
