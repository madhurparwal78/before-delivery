import { createConnection } from 'node:net';
import type { Socket } from 'node:net';

export interface SmtpAddress {
  display: string | null;
  address: string;
}

export class SmtpFailure extends Error {}

const CRLF = '\r\n';

/** Reads `Name <box@host>` or a bare address. */
export function parseAddress(value: string): SmtpAddress {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (match) {
    const display = match[1] ?? '';
    return { display: display === '' ? null : display, address: match[2] ?? '' };
  }
  return { display: null, address: value.trim() };
}

function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]*$/.test(value);
}

/** A header value with non-ASCII text is written as one RFC 2047 encoded word. */
export function headerValue(value: string): string {
  if (isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function addressHeader(address: SmtpAddress): string {
  if (address.display === null) return address.address;
  return `${headerValue(address.display)} <${address.address}>`;
}

function base64Body(body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let at = 0; at < encoded.length; at += 76) lines.push(encoded.slice(at, at + 76));
  return lines.join(CRLF);
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.deliver();
    });
    socket.on('close', () => {
      this.failure ??= new SmtpFailure('the mail server closed the connection');
      this.deliver();
    });
  }

  private deliver(): void {
    if (!this.waiting) return;
    const complete = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.test(this.buffer);
    if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('');
      return;
    }
    if (!complete) return;
    const reply = this.buffer;
    this.buffer = '';
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  async expect(expected: number): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.deliver();
    });
    if (this.failure) throw new SmtpFailure(this.failure.message);
    const code = Number(/(\d{3}) [^\r\n]*\r\n$/.exec(reply)?.[1] ?? 0);
    if (code !== expected) throw new SmtpFailure(`the mail server answered ${reply.trim()}`);
  }

  send(line: string): void {
    this.socket.write(`${line}${CRLF}`);
  }

  end(): void {
    this.socket.destroy();
  }
}

async function connect(host: string, port: number, timeoutMs: number): Promise<SmtpSession> {
  return await new Promise<SmtpSession>((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(new SmtpSession(socket));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new SmtpFailure('the mail server did not answer'));
    });
    socket.once('error', (error) => reject(new SmtpFailure(error.message)));
  });
}

export interface SmtpMessage {
  from: SmtpAddress;
  to: string;
  subject: string;
  body: string;
  date: Date;
}

/**
 * Hands one plain-text message to the SMTP server and resolves only when the server has
 * accepted it. Every message has exactly one recipient and no Cc or Bcc header.
 */
export async function deliver(
  host: string,
  port: number,
  message: SmtpMessage,
  timeoutMs: number,
): Promise<void> {
  if (host === '') throw new SmtpFailure('no mail server is configured');
  const session = await connect(host, port, timeoutMs);
  try {
    await session.expect(220);
    session.send('EHLO quirewell');
    await session.expect(250);
    session.send(`MAIL FROM:<${message.from.address}>`);
    await session.expect(250);
    session.send(`RCPT TO:<${message.to}>`);
    await session.expect(250);
    session.send('DATA');
    await session.expect(354);
    const headers = [
      `From: ${addressHeader(message.from)}`,
      `To: ${message.to}`,
      `Subject: ${headerValue(message.subject)}`,
      `Date: ${message.date.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ];
    session.send(`${headers.join(CRLF)}${CRLF}${CRLF}${base64Body(message.body)}${CRLF}.`);
    await session.expect(250);
    session.send('QUIT');
  } finally {
    session.end();
  }
}

export async function greets(host: string, port: number, timeoutMs: number): Promise<boolean> {
  if (host === '') return false;
  try {
    const session = await connect(host, port, timeoutMs);
    try {
      await session.expect(220);
      session.send('QUIT');
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
