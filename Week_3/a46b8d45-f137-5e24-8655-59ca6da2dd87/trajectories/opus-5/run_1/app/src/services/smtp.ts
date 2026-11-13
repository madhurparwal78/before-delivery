/**
 * Mailpit receives every email. The desk speaks plain SMTP to it, so a notice is only ever
 * counted as sent once Mailpit has accepted it.
 */

import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

import { config } from '../config';
import { MailUnavailable } from './outages';

const CONNECT_TIMEOUT_MS = 8000;

export interface OutgoingNotice {
  to: string;
  subject: string;
  body: string;
}

/** A header value with non-ASCII characters travels as RFC 2047 encoded words. */
function encodeHeader(value: string): string {
  if (!/[^\u0020-\u007e]/.test(value)) return value;

  // Each encoded word stays within 75 characters, so the payload is capped at 45 bytes.
  const chunks: string[] = [];
  let current = Buffer.alloc(0);
  for (const character of value) {
    const bytes = Buffer.from(character, 'utf8');
    if (current.length + bytes.length > 45) {
      chunks.push(current.toString('base64'));
      current = Buffer.alloc(0);
    }
    current = Buffer.concat([current, bytes]);
  }
  if (current.length > 0) chunks.push(current.toString('base64'));
  return chunks.map((chunk) => `=?UTF-8?B?${chunk}?=`).join('\r\n ');
}

function base64Body(body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

function buildMessage(notice: OutgoingNotice): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${notice.to}`,
    `Subject: ${encodeHeader(notice.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@holmgarth.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${base64Body(notice.body)}\r\n`;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match?.[1] ?? config.mail.from;
}

/** A conversation with the SMTP server, one command at a time. */
class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;
  private readonly lines: string[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.absorb(chunk));
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private absorb(chunk: string): void {
    this.buffer += chunk;
    let breakAt = this.buffer.indexOf('\r\n');
    while (breakAt !== -1) {
      const line = this.buffer.slice(0, breakAt);
      this.buffer = this.buffer.slice(breakAt + 2);
      // A multi-line reply keeps going while the code is followed by a hyphen.
      if (/^\d{3}-/.test(line)) {
        breakAt = this.buffer.indexOf('\r\n');
        continue;
      }
      this.lines.push(line);
      const waiting = this.waiting;
      this.waiting = null;
      if (waiting) waiting(this.lines.shift() as string);
      breakAt = this.buffer.indexOf('\r\n');
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting) waiting('');
  }

  private async nextReply(): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return queued;
    if (this.failure !== null) throw new MailUnavailable(this.failure);
    const line = await new Promise<string>((resolve) => {
      this.waiting = resolve;
    });
    if (this.failure !== null) throw new MailUnavailable(this.failure);
    return line;
  }

  async expect(expected: string): Promise<void> {
    const reply = await this.nextReply();
    if (!reply.startsWith(expected)) {
      throw new MailUnavailable(new Error(`smtp said ${reply}, wanted ${expected}`));
    }
  }

  send(command: string): void {
    this.socket.write(`${command}\r\n`);
  }

  end(): void {
    this.socket.destroy();
  }
}

async function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new MailUnavailable(new Error('smtp connect timed out')));
    });
    socket.once('error', (error: Error) => reject(new MailUnavailable(error)));
  });
}

/** Resolves only once Mailpit has accepted the message. */
export async function sendNotice(notice: OutgoingNotice): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.send('EHLO fittings-desk');
    await session.expect('250');
    session.send(`MAIL FROM:<${senderAddress()}>`);
    await session.expect('250');
    session.send(`RCPT TO:<${notice.to}>`);
    await session.expect('250');
    session.send('DATA');
    await session.expect('354');
    // A body line of a single dot would end the message early; base64 never produces one.
    session.send(`${buildMessage(notice)}.`);
    await session.expect('250');
    session.send('QUIT');
  } finally {
    session.end();
  }
}
