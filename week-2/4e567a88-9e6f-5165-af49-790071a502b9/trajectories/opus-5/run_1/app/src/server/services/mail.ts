import { randomUUID } from 'node:crypto';
import { Socket, createConnection } from 'node:net';
import { config } from '../config';

export interface Message {
  to: readonly string[];
  subject: string;
  body: string;
}

const ADDRESS = /<([^>]+)>/;
const ASCII_ONLY = /^[\x20-\x7e]*$/;

function addressOf(mailbox: string): string {
  const match = ADDRESS.exec(mailbox);
  return match ? match[1]! : mailbox.trim();
}

function encodeHeader(value: string): string {
  if (ASCII_ONLY.test(value)) return value;
  return `=?utf-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private buffer = '';
  private pending: { resolve: () => void; reject: (error: Error) => void; prefix: string } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    for (;;) {
      if (!this.pending) return;
      const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(this.buffer);
      if (!match) return;
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const waiter = this.pending;
      this.pending = null;
      if (match[1] === waiter.prefix) waiter.resolve();
      else waiter.reject(new Error(`SMTP expected ${waiter.prefix} and got ${reply.trim()}`));
    }
  }

  expect(prefix: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, prefix };
      this.drain();
    });
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }
}

/** A plain SMTP delivery; a mail outage never fails the request that caused it. */
export async function sendMail(message: Message): Promise<void> {
  if (message.to.length === 0) return;
  const from = addressOf(config.mail.from);
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to.join(', ')}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@lumenfold.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ].join('\r\n');
  const body = message.body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

  const socket = createConnection({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(10000);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('SMTP timeout')));
    });
    const session = new SmtpSession(socket);
    await session.expect('220');
    session.send('EHLO lumenfold-dispatch');
    await session.expect('250');
    session.send(`MAIL FROM:<${from}>`);
    await session.expect('250');
    for (const recipient of message.to) {
      session.send(`RCPT TO:<${addressOf(recipient)}>`);
      await session.expect('250');
    }
    session.send('DATA');
    await session.expect('354');
    socket.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await session.expect('250');
    session.send('QUIT');
  } catch (error) {
    console.error('mail delivery failed', { subject: message.subject, error: String(error) });
  } finally {
    socket.destroy();
  }
}
