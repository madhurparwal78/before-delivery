import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { env } from '../env';

export interface OutgoingMail {
  to: string;
  toName: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

const CONNECT_TIMEOUT_MS = 5000;

class SmtpSession {
  private buffer = '';
  private readonly waiters: { resolve: (lines: string) => void; reject: (error: Error) => void }[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private drain(): void {
    for (;;) {
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/u.exec(this.buffer);
      if (!match) return;
      const block = match[0];
      this.buffer = this.buffer.slice(block.length);
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      const code = Number(block.slice(0, 3));
      if (code >= 400) waiter.reject(new Error(`SMTP error: ${block.trim()}`));
      else waiter.resolve(block);
    }
  }

  private fail(error: Error): void {
    while (this.waiters.length > 0) this.waiters.shift()?.reject(error);
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.drain();
    });
  }

  async command(line: string): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.read();
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.smtp.host, port: env.smtp.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    socket.once('error', (error) => reject(error));
  });
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/gu, '\r\n').replace(/^\./gmu, '..');
}

function mailboxAddress(from: string): string {
  const match = /<([^>]+)>/u.exec(from);
  return match ? match[1] : from.trim();
}

function renderMessage(mail: OutgoingMail): string {
  const boundary = `--=_ed_${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${env.mailFrom}`,
    `To: ${encodeHeaderValue(mail.toName)} <${mail.to}>`,
    `Subject: ${encodeHeaderValue(mail.subject)}`,
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@loomwise.example>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(mail.textBody),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(mail.htmlBody),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return `${headers}\r\n\r\n${parts}`;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.read();
    await session.command('EHLO evidence-desk');
    await session.command(`MAIL FROM:<${mailboxAddress(env.mailFrom)}>`);
    await session.command(`RCPT TO:<${mail.to}>`);
    await session.command('DATA');
    session.write(`${renderMessage(mail)}\r\n.\r\n`);
    await session.read();
    await session.command('QUIT').catch(() => undefined);
  } finally {
    session.end();
  }
}
