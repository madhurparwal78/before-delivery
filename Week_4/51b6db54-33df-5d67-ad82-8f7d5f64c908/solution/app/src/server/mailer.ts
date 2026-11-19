import { connect } from 'node:net';
import { config } from './config';
import { rows, transaction, type Queryable } from './db';

export interface Mail {
  to: string;
  subject: string;
  body: string;
  mention?: { commentId: number; userId: number };
}

export async function enqueueMail(q: Queryable, mail: Mail): Promise<void> {
  await q.query('INSERT INTO outbox (to_email, subject, body, mention_comment, mention_user) VALUES ($1, $2, $3, $4, $5)', [
    mail.to,
    mail.subject,
    mail.body,
    mail.mention?.commentId ?? null,
    mail.mention?.userId ?? null,
  ]);
}

const address = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
const header = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

function smtpSend(mail: { to: string; subject: string; body: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.smtp.port, config.smtp.host);
    socket.setTimeout(10000, () => socket.destroy(new Error('smtp timeout')));
    let buffer = '';
    let step = 0;
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${header(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      ...mail.body.replace(/\r?\n/g, '\n').split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
      '.',
    ].join('\r\n');
    const script = [
      `EHLO celmate`,
      `MAIL FROM:<${address(config.mailFrom)}>`,
      `RCPT TO:<${address(mail.to)}>`,
      'DATA',
      message,
      'QUIT',
    ];
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end = buffer.indexOf('\r\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\r\n');
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const expected = step === 0 ? 220 : step === 4 ? 354 : step === 5 ? 250 : step === 6 ? 221 : 250;
        if (code !== expected) return reject(new Error(`smtp ${line}`));
        const next = script[step];
        step += 1;
        if (next === undefined) return resolve();
        socket.write(`${next}\r\n`);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => (step >= script.length ? resolve() : reject(new Error('smtp closed'))));
  });
}

interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  attempts: number;
  mention_comment: number | null;
  mention_user: number | null;
}

/** Sends pending outbox rows once each; a delivered mention is reported to the caller. */
async function deliverPending(onMentionDelivered: (commentId: number) => Promise<void>): Promise<void> {
  const sent = await transaction(async (tx) => {
    const batch = await rows<OutboxRow>(
      tx,
      `SELECT id, to_email, subject, body, attempts, mention_comment, mention_user FROM outbox
       WHERE state = 'pending' AND retry_at <= now() ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED`,
    );
    const done: number[] = [];
    for (const mail of batch) {
      try {
        await smtpSend({ to: mail.to_email, subject: mail.subject, body: mail.body });
        await tx.query("UPDATE outbox SET state = 'sent' WHERE id = $1", [mail.id]);
        if (mail.mention_comment !== null) {
          await tx.query("UPDATE mentions SET state = 'delivered' WHERE comment_id = $1 AND user_id = $2", [mail.mention_comment, mail.mention_user]);
          done.push(mail.mention_comment);
        }
      } catch {
        await tx.query("UPDATE outbox SET attempts = attempts + 1, retry_at = now() + make_interval(secs => LEAST(30, 2 * (attempts + 1))) WHERE id = $1", [mail.id]);
      }
    }
    return done;
  });
  for (const commentId of new Set(sent)) await onMentionDelivered(commentId);
}

export function startMailer(onMentionDelivered: (commentId: number) => Promise<void>): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    void deliverPending(onMentionDelivered)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, 400);
}
