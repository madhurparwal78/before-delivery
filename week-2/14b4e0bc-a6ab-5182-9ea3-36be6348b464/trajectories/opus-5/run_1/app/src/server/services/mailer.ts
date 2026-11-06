import { createConnection } from 'node:net';
import { env } from '../env.ts';
import { query } from '../db.ts';
import { noticeMessageId, recipientHeader } from '../domain/notices.ts';

const SMTP_TIMEOUT_MS = 10_000;
const SENDER_INTERVAL_MS = 5_000;
const CLAIM_LEASE_SECONDS = 30;

export interface OutgoingNotice {
  id: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

class SmtpSession {
  private readonly socket: ReturnType<typeof createConnection>;
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(host: string, port: number) {
    this.socket = createConnection({ host, port });
    this.socket.setTimeout(SMTP_TIMEOUT_MS);
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    this.socket.on('error', (error: Error) => {
      this.failure = error;
      this.flush();
    });
    this.socket.on('timeout', () => {
      this.failure = new Error('smtp timeout');
      this.socket.destroy();
      this.flush();
    });
  }

  private flush(): void {
    if (this.pending === null) return;
    if (this.failure !== null) {
      const resolve = this.pending;
      this.pending = null;
      resolve('000 failed');
      return;
    }
    const match = /(^|\n)(\d{3}) [^\n]*\r?\n/.exec(this.buffer);
    if (!match) return;
    const resolve = this.pending;
    this.pending = null;
    this.buffer = '';
    resolve(match[2]);
  }

  private reply(): Promise<string> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.flush();
    });
  }

  private async expect(code: string): Promise<void> {
    const reply = await this.reply();
    if (this.failure !== null) throw this.failure;
    if (!reply.startsWith(code.slice(0, 1))) throw new Error(`smtp replied ${reply}`);
  }

  private write(line: string): void {
    this.socket.write(line);
  }

  async send(notice: OutgoingNotice): Promise<void> {
    await this.expect('2');
    this.write('EHLO strata\r\n');
    await this.expect('2');
    const fromAddress = /<([^>]+)>/.exec(env.mailFrom)?.[1] ?? env.mailFrom;
    this.write(`MAIL FROM:<${fromAddress}>\r\n`);
    await this.expect('2');
    this.write(`RCPT TO:<${notice.recipientEmail}>\r\n`);
    await this.expect('2');
    this.write('DATA\r\n');
    await this.expect('3');
    const headers = [
      `From: ${env.mailFrom}`,
      `To: ${recipientHeader(notice.recipientName, notice.recipientEmail)}`,
      `Subject: ${notice.subject}`,
      `Message-ID: ${noticeMessageId(notice.id)}`,
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const body = notice.body
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    this.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await this.expect('2');
    this.write('QUIT\r\n');
    this.socket.end();
  }

  close(): void {
    this.socket.destroy();
  }
}

export async function sendNotice(notice: OutgoingNotice): Promise<void> {
  const session = new SmtpSession(env.smtp.host, env.smtp.port);
  try {
    await session.send(notice);
  } finally {
    session.close();
  }
}

export async function probeMailRelay(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: env.smtp.host, port: env.smtp.port });
    const finish = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(3000);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

/** Claims one queued notice under a lease, so no other instance sends it meanwhile. */
async function claimNotice(): Promise<OutgoingNotice | null> {
  const result = await query<{
    id: string;
    recipient_name: string;
    recipient_email: string;
    subject: string;
    body: string;
  }>(
    `UPDATE notices SET state = 'claimed', claim_expires_at = now() + interval '${CLAIM_LEASE_SECONDS} seconds'
      WHERE id = (
        SELECT id FROM notices
         WHERE state = 'queued'
            OR (state = 'claimed' AND claim_expires_at < now())
         ORDER BY queued_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING id, recipient_name, recipient_email, subject, body`,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    body: row.body,
  };
}

async function releaseNotice(noticeId: string): Promise<void> {
  await query(
    `UPDATE notices SET state = 'queued', claim_expires_at = NULL
      WHERE id = $1 AND state = 'claimed'`,
    [noticeId],
  );
}

async function markSent(noticeId: string): Promise<void> {
  await query(`UPDATE notices SET state = 'sent', claim_expires_at = NULL WHERE id = $1`, [noticeId]);
}

async function drainOnce(): Promise<void> {
  for (;;) {
    const notice = await claimNotice();
    if (notice === null) return;
    try {
      await sendNotice(notice);
      await markSent(notice.id);
    } catch {
      await releaseNotice(notice.id);
      return;
    }
  }
}

/** Every instance runs a sender that tries every 5 seconds. */
export function startNoticeSender(): void {
  const tick = (): void => {
    drainOnce()
      .catch(() => undefined)
      .finally(() => {
        setTimeout(tick, SENDER_INTERVAL_MS).unref();
      });
  };
  setTimeout(tick, 1000).unref();
}
