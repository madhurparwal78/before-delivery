// The pending mail table and its delivery over SMTP, each message once.

import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { config } from './config';
import { pool, rows, type Runner, type Row } from './db';

interface OutgoingMail {
  clientId: string | null;
  to: string;
  subject: string;
  body: string;
  calendar?: { text: string; method: 'REQUEST' | 'CANCEL' };
}

export async function queueMail(db: Runner, mail: OutgoingMail): Promise<void> {
  await db.query(
    `INSERT INTO pending_mail (id, client_id, recipient, subject, body, calendar, calendar_method) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), mail.clientId, mail.to, mail.subject, mail.body, mail.calendar?.text ?? null, mail.calendar?.method ?? null],
  );
}

function encodedHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

function encodedFrom(value: string): string {
  const named = /^(.*)<(.+)>$/.exec(value);
  return named ? `${encodedHeader((named[1] as string).trim())} <${named[2]}>` : value;
}

function base64Lines(text: string): string {
  return (Buffer.from(text).toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function message(row: Row): string {
  const heads = [
    `From: ${encodedFrom(config.mailFrom)}`,
    `To: <${row.recipient}>`,
    `Subject: ${encodedHeader(row.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${row.id}@noorbakkerboards.example>`,
    'MIME-Version: 1.0',
  ];
  const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', base64Lines(row.body)];
  if (!row.calendar) return [...heads, ...textPart].join('\r\n');
  const boundary = `part-${row.id}`;
  return [
    ...heads,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    `Content-Type: text/calendar; charset=utf-8; method=${row.calendar_method}; name="call.ics"`,
    'Content-Disposition: attachment; filename="call.ics"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(row.calendar),
    `--${boundary}--`,
  ].join('\r\n');
}

function address(value: string): string {
  return /<(.+)>/.exec(value)?.[1] ?? value;
}

/** One SMTP conversation carrying one message. */
function deliver(row: Row): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(config.smtpPort, config.smtpHost);
    const script = [
      `EHLO noorbakkerboards.example`,
      `MAIL FROM:<${address(config.mailFrom)}>`,
      `RCPT TO:<${row.recipient}>`,
      'DATA',
      `${message(row)}\r\n.`,
      'QUIT',
    ];
    let buffer = '';
    let step = 0;
    socket.setTimeout(10_000, () => socket.destroy(new Error('the mail server did not answer')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() as string;
      for (const line of lines) {
        if (line[3] === '-') continue;
        if (!/^[23]/.test(line)) {
          socket.destroy(new Error(`the mail server refused: ${line}`));
          return;
        }
        const next = script[step];
        step += 1;
        if (next === undefined) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${next}\r\n`);
      }
    });
  });
}

let delivering = false;

/** Sends what is pending. A closing or erasing client's mail waits; a failed message stays pending. */
export async function deliverPendingMail(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    for (;;) {
      const pending = await rows(
        pool,
        `SELECT m.* FROM pending_mail m LEFT JOIN clients c ON c.id = m.client_id
         WHERE m.sent_at IS NULL AND (m.client_id IS NULL OR c.state = 'active') ORDER BY m.seq LIMIT 25`,
      );
      if (!pending.length) return;
      for (const row of pending) {
        await deliver(row);
        await pool.query('UPDATE pending_mail SET sent_at = $1 WHERE id = $2', [new Date(), row.id]);
      }
    }
  } catch (error) {
    console.error('mail delivery will try again:', (error as Error).message);
  } finally {
    delivering = false;
  }
}
