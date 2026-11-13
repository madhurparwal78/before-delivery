import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { config } from './config.js';
import { db } from './db.js';

const PROBE_MS = 2000;
const SOCKET_MS = 8000;
const RETRY_SECONDS = 10;
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 60;

class Conversation {
  private buffer = '';
  private waiting: ((reply: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(SOCKET_MS, () => socket.destroy(new Error('smtp timeout')));
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.failure?.(error));
    socket.on('close', () => this.failure?.(new Error('smtp connection closed')));
  }

  private flush(): void {
    const lines = this.buffer.split('\r\n');
    const last = lines.filter((line) => line !== '').at(-1);
    if (this.waiting && this.buffer.endsWith('\r\n') && last !== undefined && /^\d{3} /.test(last)) {
      const reply = this.buffer;
      this.buffer = '';
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      this.failure = reject;
      this.flush();
    });
  }

  async command(line: string, expect: string): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!reply.startsWith(expect)) throw new Error(`smtp refused ${line.split(' ')[0]}: ${reply.trim()}`);
  }
}

async function converse<T>(work: (talk: Conversation) => Promise<T>): Promise<T> {
  const { host, port } = config.smtp;
  if (!host) throw new Error('mail is not configured');
  const socket = net.connect({ host, port });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const talk = new Conversation(socket);
    const banner = await talk.reply();
    if (!banner.startsWith('220')) throw new Error('smtp banner refused');
    const result = await work(talk);
    socket.write('QUIT\r\n');
    return result;
  } finally {
    socket.destroy();
  }
}

function address(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from.trim();
}

const header = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

function compose(to: string, subject: string, body: string): string {
  const wrapped = (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@keyway.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
  ].join('\r\n');
}

/** The one SMTP client: delivers a message, and probes the server for the health figure. */
class Mailer {
  private up = false;
  private busy = false;
  private onSettled: (playtestId: string) => void = () => undefined;

  get available(): boolean {
    return this.up;
  }

  /** `onSettled` hears about every message whose delivery state changed, so open sheets can refresh. */
  start(onSettled: (playtestId: string) => void): void {
    this.onSettled = onSettled;
    if (!config.smtp.host) return;
    void this.watch();
    void this.drain();
  }

  /** Sends what is due right now instead of waiting for the next tick. */
  kick(): void {
    if (this.up && db.available) void this.sendDue().catch(() => undefined);
  }

  private async watch(): Promise<void> {
    for (;;) {
      this.up = await converse(async () => true).catch(() => false);
      await new Promise((resolve) => setTimeout(resolve, PROBE_MS));
    }
  }

  private async deliver(to: string, subject: string, body: string): Promise<void> {
    await converse(async (talk) => {
      await talk.command('EHLO keyway', '250');
      await talk.command(`MAIL FROM:<${address(config.smtp.from)}>`, '250');
      await talk.command(`RCPT TO:<${to}>`, '250');
      await talk.command('DATA', '354');
      await talk.command(`${compose(to, subject, body)}\r\n.`, '250');
    }).catch((error: unknown) => {
      this.up = false;
      throw error;
    });
  }

  /** Sends due outbox rows while the server is reachable: sent, or retried every 10 seconds up to 3 failed attempts. */
  private async drain(): Promise<void> {
    for (;;) {
      if (this.up && db.available) await this.sendDue().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async sendDue(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.sendBatch();
    } finally {
      this.busy = false;
    }
  }

  private async sendBatch(): Promise<void> {
    const due = await db.query<{ id: string; playtest_id: string; to_email: string; subject: string; body: string; attempts: number }>(
      `UPDATE outbox SET next_attempt_at = clock_timestamp() + make_interval(secs => $1)
       WHERE id IN (SELECT id FROM outbox WHERE status = 'queued' AND next_attempt_at <= clock_timestamp()
                    ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)
       RETURNING id, playtest_id, to_email, subject, body, attempts`,
      [LEASE_SECONDS],
    );
    for (const row of due.rows) {
      try {
        await this.deliver(row.to_email, row.subject, row.body);
        await db.query(`UPDATE outbox SET status = 'sent' WHERE id = $1`, [row.id]);
        this.onSettled(row.playtest_id);
      } catch {
        const attempts = row.attempts + 1;
        await db.query(
          `UPDATE outbox SET attempts = $2, status = $3, next_attempt_at = clock_timestamp() + make_interval(secs => $4) WHERE id = $1`,
          [row.id, attempts, attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', RETRY_SECONDS],
        );
        if (attempts >= MAX_ATTEMPTS) this.onSettled(row.playtest_id);
      }
    }
  }
}

export const mailer = new Mailer();
