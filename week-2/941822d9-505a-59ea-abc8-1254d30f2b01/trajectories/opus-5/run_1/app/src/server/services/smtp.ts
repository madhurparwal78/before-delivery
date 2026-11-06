import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const CONNECT_TIMEOUT_MS = 5000;

class SmtpSession {
  private buffer = '';
  private readonly pending: { expect: number; resolve: () => void; reject: (error: Error) => void }[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.consume(chunk));
    socket.on('error', (error: Error) => this.failAll(error));
    socket.on('close', () => this.failAll(new Error('SMTP connection closed')));
  }

  private failAll(error: Error): void {
    while (this.pending.length > 0) this.pending.shift()?.reject(error);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const lineEnd = this.buffer.indexOf('\n');
      if (lineEnd === -1) return;
      const line = this.buffer.slice(0, lineEnd).replace(/\r$/, '');
      this.buffer = this.buffer.slice(lineEnd + 1);
      // Multi-line replies mark every line but the last with a hyphen.
      if (/^\d{3}-/.test(line)) continue;
      const code = Number.parseInt(line.slice(0, 3), 10);
      const waiter = this.pending.shift();
      if (waiter === undefined) continue;
      if (code === waiter.expect) waiter.resolve();
      else waiter.reject(new Error(`SMTP expected ${waiter.expect} but got ${line}`));
    }
  }

  private await(expect: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ expect, resolve, reject });
    });
  }

  async command(text: string, expect: number): Promise<void> {
    const reply = this.await(expect);
    this.socket.write(`${text}\r\n`);
    await reply;
  }

  async greeting(): Promise<void> {
    await this.await(220);
  }

  async data(payload: string, expect: number): Promise<void> {
    const reply = this.await(expect);
    this.socket.write(payload);
    await reply;
  }

  end(): void {
    this.socket.end();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
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

function senderAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.greeting();
    await session.command('EHLO credwell', 250);
    await session.command(`MAIL FROM:<${senderAddress(config.mail.from)}>`, 250);
    await session.command(`RCPT TO:<${mail.to}>`, 250);
    await session.command('DATA', 354);
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${mail.to}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@credwell.test>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    await session.data(`${headers}\r\n\r\n${dotStuff(mail.body)}\r\n.\r\n`, 250);
    await session.command('QUIT', 221);
  } finally {
    session.end();
  }
}
