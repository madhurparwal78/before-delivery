import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { config } from '../config.js';

const TIMEOUT_MS = 5000;

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

class SmtpSession {
  private buffer = '';
  private pending: { expect: number; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    const waiter = this.pending;
    if (!waiter) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index]!;
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(index + 1).join('\r\n');
        this.pending = null;
        const code = Number(line.slice(0, 3));
        if (code !== waiter.expect) {
          waiter.reject(new Error(`SMTP replied ${line}`));
          return;
        }
        waiter.resolve();
        return;
      }
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending = { expect: code, resolve, reject };
      this.drain();
    });
  }

  async command(line: string, code: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(code);
  }
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function senderAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from.trim();
}

/** Sends one message over plain SMTP. A call that takes longer than 5 seconds counts as unreachable. */
export async function sendMail(message: MailMessage): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new Error('SMTP connect timed out'));
    }, TIMEOUT_MS);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  socket.setTimeout(TIMEOUT_MS);
  const failure = new Promise<never>((_, reject) => {
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('SMTP timed out')));
    socket.once('close', () => reject(new Error('SMTP closed')));
  });

  const session = new SmtpSession(socket);
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ].join('\r\n');

  const conversation = (async (): Promise<void> => {
    await session.expect(220);
    await session.command('EHLO tidemark', 250);
    await session.command(`MAIL FROM:<${senderAddress(config.mail.from)}>`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250);
    await session.command('DATA', 354);
    socket.write(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    await session.expect(250);
    socket.write('QUIT\r\n');
  })();

  try {
    await Promise.race([conversation, failure]);
  } finally {
    socket.removeAllListeners('close');
    socket.removeAllListeners('error');
    socket.destroy();
  }
}
