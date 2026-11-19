import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

/** Raised when mail cannot be reached, so callers keep the work queued. */
export class MailUnavailable extends Error {
  constructor(cause: string) {
    super(`Email is unavailable: ${cause}`);
    this.name = 'MailUnavailable';
  }
}

export interface OutgoingMail {
  /** Exactly one recipient; no Cc or Bcc is ever sent. */
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const CONNECT_TIMEOUT_MS = 5_000;
const ENCODED_WORD_PAYLOAD_LIMIT = 42;

function isAscii(value: string): boolean {
  return !/[^\x20-\x7e]/.test(value);
}

/**
 * RFC 2047 UTF-8 encoded words. A subject holding any non-ASCII character is written so that
 * the subject a reader decodes equals the intended subject character for character.
 */
function encodeSubject(subject: string): string {
  if (isAscii(subject)) return subject;
  const words: string[] = [];
  let chunk = Buffer.alloc(0);
  for (const character of subject) {
    const encoded = Buffer.from(character, 'utf8');
    if (chunk.length + encoded.length > ENCODED_WORD_PAYLOAD_LIMIT) {
      words.push(`=?UTF-8?B?${chunk.toString('base64')}?=`);
      chunk = Buffer.alloc(0);
    }
    chunk = Buffer.concat([chunk, encoded]);
  }
  if (chunk.length > 0) words.push(`=?UTF-8?B?${chunk.toString('base64')}?=`);
  // Folding white space between encoded words is removed by the decoder.
  return words.join('\r\n ');
}

function base64Body(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

/** The bare address inside a `Display Name <address>` From line. */
function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return (match?.[1] ?? config.smtp.from).trim();
}

function buildMessage(mail: OutgoingMail): string {
  const boundary = `lanternfold-${randomUUID()}`;
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@lanternfold.test>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(mail.html),
    `--${boundary}--`,
    '',
  ];
  return [...headers, '', ...parts].join('\r\n');
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
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.pending?.('');
    });
  }

  private drain(): void {
    if (!this.pending) return;
    // A reply ends with a line whose fourth character is a space, as in "250 Ok".
    const match = /^(?:\d{3}-[^\r\n]*\r\n)*(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (!match) return;
    const reply = this.buffer.slice(0, match[0].length);
    this.buffer = this.buffer.slice(match[0].length);
    const resolve = this.pending;
    this.pending = null;
    resolve(reply);
  }

  async expect(codes: readonly string[]): Promise<string> {
    const reply = await new Promise<string>((resolve) => {
      this.pending = resolve;
      this.drain();
    });
    if (this.failure) throw new MailUnavailable(this.failure.message);
    const code = /(\d{3}) [^\r\n]*\r\n$/.exec(reply)?.[1] ?? '';
    if (!codes.includes(code)) throw new MailUnavailable(`server said ${reply.trim()}`);
    return reply;
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  async command(line: string, codes: readonly string[]): Promise<string> {
    this.send(line);
    return this.expect(codes);
  }

  end(): void {
    this.socket.destroy();
  }
}

async function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    const fail = (error: Error): void => {
      socket.destroy();
      reject(new MailUnavailable(error.message));
    };
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('connection timed out')));
  });
}

/** Delivers one message with exactly one `To` recipient. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect(['220']);
    await session.command('EHLO lanternfold', ['250']);
    await session.command(`MAIL FROM:<${senderAddress()}>`, ['250']);
    await session.command(`RCPT TO:<${mail.to}>`, ['250', '251']);
    await session.command('DATA', ['354']);
    for (const line of buildMessage(mail).split('\r\n')) {
      // Dot-stuffing keeps a body line of a single dot from ending the message.
      session.send(line.startsWith('.') ? `.${line}` : line);
    }
    await session.command('.', ['250']);
    await session.command('QUIT', ['221']);
  } finally {
    session.end();
  }
}

export async function mailIsUp(): Promise<boolean> {
  try {
    const socket = await connect();
    const session = new SmtpSession(socket);
    try {
      await session.expect(['220']);
      await session.command('QUIT', ['221']);
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
