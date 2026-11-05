import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

export class MailUnavailable extends Error {
  constructor(detail: string) {
    super(`Mailpit is not answering: ${detail}`);
    this.name = 'MailUnavailable';
  }
}

const TIMEOUT_MS = 6_000;

function envelopeAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled?.[1] ?? from.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.pending?.('500 socket error');
      this.pending = null;
    });
  }

  private drain(): void {
    while (this.pending !== null) {
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
      if (match === null) return;
      const block = match[0];
      this.buffer = this.buffer.slice(block.length);
      const resolve = this.pending;
      this.pending = null;
      resolve(block.trimEnd());
    }
  }

  async expect(prefix: string): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.pending = resolve;
      this.drain();
    });
    if (this.failure !== null) throw new MailUnavailable(this.failure.message);
    const lastLine = reply.split('\n').at(-1) ?? reply;
    if (!lastLine.startsWith(prefix)) {
      throw new MailUnavailable(`unexpected reply ${lastLine}`);
    }
  }

  write(line: string): void {
    this.socket.write(line);
  }
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new MailUnavailable('connect timeout'));
    }, TIMEOUT_MS);
    connection.once('connect', () => {
      clearTimeout(timer);
      resolve(connection);
    });
    connection.once('error', (error) => {
      clearTimeout(timer);
      reject(new MailUnavailable(error.message));
    });
  });

  socket.setTimeout(TIMEOUT_MS, () => socket.destroy());
  const session = new SmtpSession(socket);
  const sender = envelopeAddress(config.mail.from);
  const message = [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
  ].join('\r\n');

  try {
    await session.expect('220');
    session.write('EHLO opaline-bench-days\r\n');
    await session.expect('250');
    session.write(`MAIL FROM:<${sender}>\r\n`);
    await session.expect('250');
    session.write(`RCPT TO:<${to}>\r\n`);
    await session.expect('250');
    session.write('DATA\r\n');
    await session.expect('354');
    session.write(`${message}\r\n.\r\n`);
    await session.expect('250');
    session.write('QUIT\r\n');
  } finally {
    socket.end();
    socket.destroy();
  }
}
