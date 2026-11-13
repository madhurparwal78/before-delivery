import { createConnection, type Socket } from 'node:net';
import { config } from '../config';
import { isDown } from './outage';

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Mail is unavailable');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

export interface Message {
  to: string;
  subject: string;
  text: string;
}

const addressOf = (from: string): string => {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from.trim() : match[1].trim();
};

class SmtpSession {
  private buffer = '';
  private waiting: { expect: number; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.consume(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\r\n');
    for (const line of lines) {
      if (line.length < 4 || line[3] === '-') continue;
      const code = Number(line.slice(0, 3));
      const pending = this.waiting;
      this.buffer = '';
      if (pending === null) return;
      this.waiting = null;
      if (code === pending.expect) pending.resolve();
      else pending.reject(new Error(`SMTP replied ${line}`));
      return;
    }
  }

  private fail(error: Error): void {
    const pending = this.waiting;
    this.waiting = null;
    pending?.reject(error);
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = { expect: code, resolve, reject };
    });
  }

  async command(text: string, code: number): Promise<void> {
    const done = this.expect(code);
    this.socket.write(`${text}\r\n`);
    await done;
  }

  end(): void {
    this.socket.end();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    socket.once('error', reject);
  });
}

/** Sends one message; resolves only once the mail server has accepted it. */
export async function sendMail(message: Message): Promise<void> {
  if (isDown('mail')) throw new MailUnavailable();
  let socket: Socket;
  try {
    socket = await connect();
  } catch (error) {
    throw new MailUnavailable(error);
  }
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.command('EHLO galley', 250);
    await session.command(`MAIL FROM:<${addressOf(config.mail.from)}>`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250);
    await session.command('DATA', 354);
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    const body = message.text
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    await session.command(`${headers}\r\n\r\n${body}\r\n.`, 250);
    session.end();
  } catch (error) {
    socket.destroy();
    throw new MailUnavailable(error);
  }
}
