import { createConnection } from 'node:net';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';

const RETRY_SECONDS = 30;
const MAX_ATTEMPTS = 10;

type Envelope = { to: string; subject: string; body: string };

function addressOf(mailFrom: string): string {
  const bracketed = /<([^>]+)>/.exec(mailFrom);
  return bracketed ? (bracketed[1] as string) : mailFrom.trim();
}

function encodeHeader(value: string): string {
  if (!/[^\x20-\x7e]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

async function speakSmtp(envelope: Envelope): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    let buffered = '';
    const steps = [
      `EHLO tramela\r\n`,
      `MAIL FROM:<${addressOf(config.mailFrom)}>\r\n`,
      `RCPT TO:<${envelope.to}>\r\n`,
      `DATA\r\n`,
      `${buildMessage(envelope)}\r\n.\r\n`,
      `QUIT\r\n`,
    ];
    let step = -1;

    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };

    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('SMTP timed out')));
    socket.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      while (true) {
        const breakAt = buffered.indexOf('\r\n');
        if (breakAt === -1) return;
        const line = buffered.slice(0, breakAt);
        buffered = buffered.slice(breakAt + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) return fail(new Error(`SMTP refused: ${line}`));
        step += 1;
        const next = steps[step];
        if (next === undefined) {
          socket.end();
          resolve();
          return;
        }
        socket.write(next);
      }
    });
  });
}

function buildMessage(envelope: Envelope): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeHeader(envelope.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${dotStuff(envelope.body)}`;
}

/**
 * Claims one unsent message at a time so no app copy sends an order's confirmation twice,
 * then retries every 30 seconds up to 10 attempts.
 */
async function drainOutbox(): Promise<void> {
  while (true) {
    const claimed = await withTransaction(async (tx) => {
      const rows = (
        await tx.query(
          `SELECT id, to_address, subject, body, attempts FROM mail_outbox
           WHERE sent_at IS NULL AND abandoned = false AND next_attempt_at <= now()
           ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows;
      const row = rows[0];
      if (!row) return null;
      await tx.query(
        `UPDATE mail_outbox SET attempts = attempts + 1,
           next_attempt_at = now() + ($2 || ' seconds')::interval,
           abandoned = (attempts + 1 >= $3)
         WHERE id = $1`,
        [row['id'], String(RETRY_SECONDS), MAX_ATTEMPTS],
      );
      return row;
    });
    if (!claimed) return;

    try {
      await speakSmtp({
        to: claimed['to_address'] as string,
        subject: claimed['subject'] as string,
        body: claimed['body'] as string,
      });
      await query(`UPDATE mail_outbox SET sent_at = now(), abandoned = false WHERE id = $1`, [
        claimed['id'],
      ]);
    } catch {
      return;
    }
  }
}

export function startMailWorker(): void {
  void drainOutbox();
  setInterval(() => void drainOutbox(), 3000).unref();
}
