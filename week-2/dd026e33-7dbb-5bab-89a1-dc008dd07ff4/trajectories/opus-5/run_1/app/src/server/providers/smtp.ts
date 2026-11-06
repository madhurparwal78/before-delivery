import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('The mail service is unreachable');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.drain();
    });
    socket.on('close', () => {
      if (this.failure === null) this.failure = new Error('connection closed');
      this.drain();
    });
  }

  private drain(): void {
    if (this.waiting === null) return;
    const complete = this.completeReply();
    if (complete !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(complete);
      return;
    }
    if (this.failure !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('');
    }
  }

  private completeReply(): string | null {
    const lines = this.buffer.split('\r\n');
    for (const [index, line] of lines.entries()) {
      if (/^\d{3} /.test(line)) {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        return reply;
      }
    }
    return null;
  }

  async expect(codes: readonly number[]): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
    const match = /(\d{3}) /.exec(reply);
    const code = match === null ? 0 : Number(match[1]);
    if (!codes.includes(code)) {
      throw new MailUnavailable(new Error(`SMTP answered ${reply.trim() || 'nothing'}`));
    }
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  sendData(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }
}

function connect(timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new MailUnavailable(new Error('connection timed out')));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(new MailUnavailable(error));
    });
  });
}

export async function mailAnswers(): Promise<boolean> {
  try {
    const socket = await connect(2000);
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

function encodeHeader(value: string): string {
  if (!/[^\u0020-\u007e]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from.trim() : (match[1] ?? from.trim());
}

function buildMessage(mail: OutgoingMail): string {
  const lines = [
    `From: ${config.mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@marrowlark.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(mail.body, 'utf8').toString('base64');
  const wrapped = encoded.match(/.{1,76}/g) ?? [''];
  return `${lines.join('\r\n')}\r\n\r\n${wrapped.join('\r\n')}\r\n.\r\n`;
}

/** Sends one message, or throws so the caller can keep the effect queued. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await connect(5000);
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    session.send('EHLO lacquer');
    await session.expect([250]);
    session.send(`MAIL FROM:<${addressOf(config.mail.from)}>`);
    await session.expect([250]);
    session.send(`RCPT TO:<${mail.to}>`);
    await session.expect([250, 251]);
    session.send('DATA');
    await session.expect([354]);
    session.sendData(buildMessage(mail));
    await session.expect([250]);
    session.send('QUIT');
  } finally {
    session.close();
  }
}
