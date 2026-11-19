import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

const TIMEOUT_MS = 10000;

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

/** The address inside a From line such as `Saffron & Slate <tables@saffronslate.example>`. */
function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

function replyCode(reply: string): number {
  const lines = reply.trimEnd().split('\r\n');
  return Number((lines[lines.length - 1] ?? '').slice(0, 3));
}

class SmtpSession {
  private buffer = '';

  private pending: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
  }

  private flush(): void {
    for (;;) {
      // A reply ends with a line whose fourth character is a space, as in `250 OK`.
      const match = /^(?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n/.exec(this.buffer);
      if (!match || !this.pending) return;
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const resolve = this.pending;
      this.pending = null;
      resolve(reply);
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP reply timed out')), TIMEOUT_MS);
      this.pending = (reply) => {
        clearTimeout(timer);
        resolve(reply);
      };
      this.flush();
    });
  }

  async command(line: string, expected: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (replyCode(reply) !== expected) {
      throw new Error(`SMTP ${line.split(' ')[0] ?? ''} answered ${reply.trim()}`);
    }
  }

  write(data: string): void {
    this.socket.write(data);
  }
}

/** Sends one plain-text message over SMTP. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({
      host: config.smtpHost,
      port: config.smtpPort,
    });
    candidate.setTimeout(TIMEOUT_MS);
    candidate.once('connect', () => resolve(candidate));
    candidate.once('timeout', () => {
      candidate.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    candidate.once('error', reject);
  });

  const session = new SmtpSession(socket);
  try {
    await session.reply();
    await session.command('EHLO saffronslate.example', 250);
    await session.command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, 250);
    await session.command(`RCPT TO:<${mail.to}>`, 250);
    await session.command('DATA', 354);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@saffronslate.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ];
    const encoded = Buffer.from(mail.body, 'utf8').toString('base64');
    const wrapped = encoded.match(/.{1,76}/g) ?? [''];
    session.write(`${headers.join('\r\n')}\r\n\r\n${wrapped.join('\r\n')}\r\n.\r\n`);
    const reply = await session.reply();
    if (!reply.startsWith('250')) throw new Error(`SMTP DATA answered ${reply.trim()}`);
    await session.command('QUIT', 221).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}
