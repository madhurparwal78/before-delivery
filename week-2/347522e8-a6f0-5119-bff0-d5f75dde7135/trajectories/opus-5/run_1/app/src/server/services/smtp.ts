/**
 * A plain SMTP client. All mail leaves over SMTP from the configured
 * `MAIL_FROM` address; the Mailpit web API is never used by the app.
 */

import { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { SERVICE_TIMEOUT_MS, config } from '../config.js';

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('mail_unavailable');
    this.cause = cause;
  }
}

/** The bare address inside `Display Name <address>`. */
export function mailboxAddress(mailbox: string): string {
  return /<([^>]+)>/.exec(mailbox)?.[1]?.trim() ?? mailbox.trim();
}

class SmtpSession {
  private buffer = '';
  private waiting: { resolve(line: string): void; reject(error: Error): void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.abort(error));
    socket.on('close', () => this.abort(new MailUnavailable('connection closed')));
  }

  private abort(error: Error): void {
    this.failure = error;
    this.waiting?.reject(error);
    this.waiting = null;
  }

  /** Resolves the next complete reply, following multi-line continuations. */
  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (/^\d{3} /.test(line)) {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        const waiting = this.waiting;
        this.waiting = null;
        waiting.resolve(reply);
        return;
      }
    }
  }

  private nextReply(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.flush();
    });
  }

  async expect(code: number): Promise<void> {
    const reply = await this.nextReply();
    const last = reply.split('\r\n').filter((line) => line.length > 0).pop() ?? '';
    if (!last.startsWith(String(code))) {
      throw new MailUnavailable(`SMTP expected ${code} but got ${last}`);
    }
  }

  async command(line: string, code: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(code);
  }

  write(payload: string): void {
    this.socket.write(payload);
  }
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-\u007f]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(mail: OutgoingMail): string {
  const encoded = Buffer.from(mail.body, 'utf8').toString('base64');
  const wrapped = encoded.replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeaderValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@railside.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
  ].join('\r\n');
}

async function connect(): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(SERVICE_TIMEOUT_MS);
    const fail = (cause: unknown): void => {
      socket.destroy();
      reject(new MailUnavailable(cause));
    };
    socket.once('error', fail);
    socket.once('timeout', () => fail('SMTP connect timed out'));
    socket.connect(config.smtp.port, config.smtp.host, () => {
      socket.removeListener('error', fail);
      resolve(socket);
    });
  });
}

/** Delivers one message. Resolving means SMTP accepted it. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.command('EHLO railside', 250);
    await session.command(`MAIL FROM:<${mailboxAddress(config.smtp.from)}>`, 250);
    await session.command(`RCPT TO:<${mailboxAddress(mail.to)}>`, 250);
    await session.command('DATA', 354);
    session.write(`${message(mail)}\r\n.\r\n`);
    await session.expect(250);
    socket.write('QUIT\r\n');
  } catch (cause) {
    throw cause instanceof MailUnavailable ? cause : new MailUnavailable(cause);
  } finally {
    socket.destroy();
  }
}
