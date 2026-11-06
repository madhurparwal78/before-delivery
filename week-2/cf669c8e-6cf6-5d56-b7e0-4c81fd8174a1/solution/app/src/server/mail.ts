/** Mail for riders through Mailpit. A mail is a row written with the fact it reports; a worker claims and sends it once. */
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { query, sql, type Db } from './db.js';

/** Record a mail in the same transaction as the fact. The dedupe key makes a repeated fact a no-op. */
export async function queueMail(db: Db, dedupeKey: string, to: string, subject: string, body: string): Promise<void> {
  await query(db, 'INSERT INTO mails (dedupe_key, to_email, subject, body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [dedupeKey, to, subject, body]);
}

function address(from: string): string {
  const open = from.indexOf('<');
  return open >= 0 ? from.slice(open + 1, from.indexOf('>')) : from.trim();
}

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function message(to: string, subject: string, body: string): string {
  const wrapped = (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return [
    `From: ${config.smtp.from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@ommezwaai.example>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64', '', wrapped, '',
  ].join('\r\n');
}

/** A minimal SMTP conversation: no authentication, plain text, one recipient. */
function deliver(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.smtp.port, config.smtp.host);
    socket.setTimeout(10000, () => socket.destroy(new Error('smtp timeout')));
    const steps = [
      `EHLO ommezwaai.example`, `MAIL FROM:<${address(config.smtp.from)}>`, `RCPT TO:<${to}>`, 'DATA',
      `${message(to, subject, body).replace(/^\./gm, '..')}\r\n.`, 'QUIT',
    ];
    let index = -1;
    let buffer = '';
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('smtp closed')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          socket.destroy(new Error(`smtp ${line}`));
          return;
        }
        index += 1;
        if (index === steps.length) {
          socket.removeAllListeners('close');
          socket.end();
          resolve();
          return;
        }
        socket.write(`${steps[index]}\r\n`);
      }
    });
  });
}

interface MailRow { id: number; to_email: string; subject: string; body: string }

export async function sendQueued(): Promise<void> {
  const claimed = await query<MailRow>(
    sql,
    `UPDATE mails SET state = 'sending', claimed_at = now(), attempts = attempts + 1 WHERE id IN (
       SELECT id FROM mails WHERE state = 'queued' OR (state = 'sending' AND claimed_at < now() - interval '30 seconds')
       ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING id, to_email, subject, body`,
  );
  for (const mail of claimed) {
    try {
      await deliver(mail.to_email, mail.subject, mail.body);
      await query(sql, "UPDATE mails SET state = 'sent', sent_at = now() WHERE id = $1", [mail.id]);
    } catch {
      await query(sql, "UPDATE mails SET state = 'queued' WHERE id = $1", [mail.id]);
    }
  }
}

