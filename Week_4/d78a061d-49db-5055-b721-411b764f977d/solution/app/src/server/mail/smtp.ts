import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  lang: string;
}

const SOCKET_TIMEOUT_MS = 5000;

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

function encodeHeader(value: string): string {
  // Any non-ASCII subject is sent as an encoded word so Mailpit shows it verbatim.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Body(value: string): string {
  return (Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function buildMessage(mail: OutgoingMail): string {
  const boundary = `lw-${randomUUID()}`;
  return [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Language: ${mail.lang}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
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
  ].join('\r\n');
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.pending?.('');
    });
    socket.on('close', () => {
      this.failure ??= new Error('SMTP connection closed');
      this.pending?.('');
    });
  }

  private flush(): void {
    if (this.pending === null) return;
    const match = /(?:^|\n)(\d{3}) [^\n]*\n/.exec(this.buffer);
    if (!match) return;
    const index = this.buffer.indexOf(match[0]) + match[0].length;
    const reply = match[1];
    this.buffer = this.buffer.slice(index);
    const resolve = this.pending;
    this.pending = null;
    resolve(reply);
  }

  async command(line: string | null, expected: string): Promise<void> {
    if (this.failure) throw this.failure;
    const reply = await new Promise<string>((resolve) => {
      this.pending = resolve;
      if (line !== null) this.socket.write(`${line}\r\n`);
      this.flush();
    });
    if (this.failure) throw this.failure;
    if (!reply.startsWith(expected)) {
      throw new Error(`SMTP command rejected: ${line ?? 'greeting'} -> ${reply}`);
    }
  }

  end(): void {
    this.socket.destroy();
  }
}

async function connect(): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.smtp.host, port: config.smtp.port });
    candidate.setTimeout(SOCKET_TIMEOUT_MS, () => {
      candidate.destroy(new Error('SMTP connect timeout'));
    });
    candidate.once('connect', () => resolve(candidate));
    candidate.once('error', reject);
  });
}

/**
 * Sends one mail over SMTP. Every send makes a fresh connection, so a failure is
 * never cached and the first attempt after the mail server returns succeeds.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const session = new SmtpSession(await connect());
  try {
    await session.command(null, '220');
    await session.command('EHLO linewright', '250');
    await session.command(`MAIL FROM:<${envelopeAddress(config.smtp.from)}>`, '250');
    await session.command(`RCPT TO:<${mail.to}>`, '250');
    await session.command('DATA', '354');
    const body = buildMessage(mail).replace(/\r\n\./g, '\r\n..');
    await session.command(`${body}\r\n.`, '250');
    await session.command('QUIT', '221');
  } finally {
    session.end();
  }
}

/** Reaches the mail server without sending, so unknown addresses answer like known ones. */
export async function probeMail(): Promise<void> {
  const session = new SmtpSession(await connect());
  try {
    await session.command(null, '220');
    await session.command('EHLO linewright', '250');
    await session.command('QUIT', '221');
  } finally {
    session.end();
  }
}
