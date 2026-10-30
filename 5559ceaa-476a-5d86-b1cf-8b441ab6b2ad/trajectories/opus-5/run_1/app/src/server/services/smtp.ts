import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

const CONNECT_TIMEOUT_MS = 3000;

class MailUnreachable extends Error {
  constructor(cause: string) {
    super(`Mail is unreachable: ${cause}`);
    this.name = 'MailUnreachable';
  }
}

export interface Message {
  to: string;
  subject: string;
  body: string;
}

class Conversation {
  private buffer = '';
  private waiting: { expect: number; resolve: () => void; reject: (cause: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (cause) => this.fail(new MailUnreachable(cause.message)));
    socket.on('close', () => this.fail(new MailUnreachable('connection closed')));
  }

  private fail(cause: Error): void {
    const pending = this.waiting;
    this.waiting = null;
    pending?.reject(cause);
  }

  private drain(): void {
    const pending = this.waiting;
    if (pending === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] ?? '';
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(index + 1).join('\r\n');
        this.waiting = null;
        if (Number(line.slice(0, 3)) === pending.expect) pending.resolve();
        else pending.reject(new MailUnreachable(`unexpected reply ${line}`));
        return;
      }
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = { expect: code, resolve, reject };
      this.drain();
    });
  }

  async command(line: string, code: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(code);
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('timed out')));
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', (cause) => reject(new MailUnreachable(cause.message)));
  });
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Delivers one message to the mail server, throwing MailUnreachable when it cannot. */
export async function deliver(message: Message): Promise<void> {
  const socket = await connect();
  const talk = new Conversation(socket);
  try {
    await talk.expect(220);
    await talk.command(`EHLO ${new URL(config.publicUrl).hostname}`, 250);
    const envelopeFrom = /<([^>]+)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from;
    await talk.command(`MAIL FROM:<${envelopeFrom}>`, 250);
    await talk.command(`RCPT TO:<${message.to}>`, 250);
    await talk.command('DATA', 354);
    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    socket.write(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    await talk.expect(250);
    await talk.command('QUIT', 221);
  } finally {
    socket.destroy();
  }
}
