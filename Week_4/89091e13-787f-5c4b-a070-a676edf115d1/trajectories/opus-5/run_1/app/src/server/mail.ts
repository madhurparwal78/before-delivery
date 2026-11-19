import { createConnection, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db, Queryable } from './db.js';

const SEND_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 5000;

function addressOf(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return angled ? angled[1] : mailbox.trim();
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private lines: string[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\r\n');
      while (index !== -1) {
        this.push(this.buffer.slice(0, index));
        this.buffer = this.buffer.slice(index + 2);
        index = this.buffer.indexOf('\r\n');
      }
    });
  }

  private push(line: string): void {
    if (this.pending && /^\d{3} /.test(line)) {
      const resolve = this.pending;
      this.pending = null;
      resolve(line);
      return;
    }
    this.lines.push(line);
  }

  async expect(code: string): Promise<void> {
    const line = await new Promise<string>((resolve, reject) => {
      const ready = this.lines.find((candidate) => /^\d{3} /.test(candidate));
      if (ready) {
        this.lines = this.lines.filter((candidate) => candidate !== ready);
        resolve(ready);
        return;
      }
      this.pending = resolve;
      this.socket.once('error', reject);
      this.socket.once('close', () => reject(new Error('SMTP connection closed')));
    });
    if (!line.startsWith(code)) throw new Error(`SMTP expected ${code}, got ${line}`);
  }

  write(command: string): void {
    this.socket.write(`${command}\r\n`);
  }

  end(): void {
    this.socket.destroy();
  }
}

export interface OutboxMail {
  recipient: string;
  subject: string;
  body: string;
}

async function deliver(mail: OutboxMail): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.smtp.host, port: config.smtp.port });
    candidate.setTimeout(SEND_TIMEOUT_MS);
    candidate.once('connect', () => resolve(candidate));
    candidate.once('timeout', () => {
      candidate.destroy();
      reject(new Error('SMTP timeout'));
    });
    candidate.once('error', reject);
  });
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.write('EHLO fernsquare');
    await session.expect('250');
    session.write(`MAIL FROM:<${addressOf(config.smtp.from)}>`);
    await session.expect('250');
    session.write(`RCPT TO:<${mail.recipient}>`);
    await session.expect('250');
    session.write('DATA');
    await session.expect('354');
    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${mail.recipient}`,
      `Subject: ${mail.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const text = mail.body
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    session.write(`${headers}\r\n\r\n${text}\r\n.`);
    await session.expect('250');
    session.write('QUIT');
  } finally {
    session.end();
  }
}

/** Writes a mail to the outbox inside the caller's transaction. */
export async function queueMail(
  tx: Queryable,
  workspaceId: string | null,
  mail: OutboxMail,
  at: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO outbox (id, workspace_id, recipient, subject, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), workspaceId, mail.recipient, mail.subject, mail.body, at],
  );
}

let flushing = false;

/** Delivers queued mail, retrying until SMTP accepts it. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const { rows } = await db.query<{ id: string; recipient: string; subject: string; body: string }>(
      `SELECT id, recipient, subject, body FROM outbox
       WHERE sent_at IS NULL ORDER BY created_at, id LIMIT 50`,
    );
    for (const row of rows) {
      try {
        await deliver({ recipient: row.recipient, subject: row.subject, body: row.body });
        await db.query('UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1', [
          row.id,
        ]);
      } catch {
        await db.query('UPDATE outbox SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

export function startMailSender(): void {
  setInterval(() => {
    void flushOutbox();
  }, RETRY_INTERVAL_MS).unref();
}
