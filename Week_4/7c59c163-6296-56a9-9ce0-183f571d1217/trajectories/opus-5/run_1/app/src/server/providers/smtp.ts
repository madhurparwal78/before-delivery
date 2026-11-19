import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { ProviderUnreachable } from './http.js';

const PROVIDER = 'mailpit';
const ADDRESS = /<([^>]+)>/;

function addressOf(mailbox: string): string {
  return ADDRESS.exec(mailbox)?.[1] ?? mailbox;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

function message(mail: Mail): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@plumtide.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(mail.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;

  constructor(private readonly socket: import('node:net').Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  /** An SMTP reply ends on the first line whose code is followed by a space. */
  private drain(): void {
    if (this.pending === null) return;
    const final = /^\d{3} [^\r\n]*\r\n/m.exec(this.buffer);
    if (final === null) return;
    const end = final.index + final[0].length;
    const reply = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end);
    const resolve = this.pending;
    this.pending = null;
    resolve(reply.slice(reply.length - final[0].length));
  }

  read(): Promise<string> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.drain();
    });
  }

  async command(line: string, expect: string): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!reply.startsWith(expect)) throw new Error(`smtp ${line.split(' ')[0]}: ${reply.trim()}`);
  }

  write(data: string): void {
    this.socket.write(data);
  }
}

export async function sendMail(mail: Mail): Promise<void> {
  const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
    const connection = createConnection({ host: config.mail.host, port: config.mail.port });
    connection.setTimeout(10_000);
    connection.once('connect', () => resolve(connection));
    connection.once('timeout', () => {
      connection.destroy();
      reject(new ProviderUnreachable(PROVIDER, 'timeout'));
    });
    connection.once('error', (error) => reject(new ProviderUnreachable(PROVIDER, error)));
  });

  try {
    const session = new SmtpSession(socket);
    const greeting = await session.read();
    if (!greeting.startsWith('220')) throw new Error(`smtp greeting: ${greeting.trim()}`);
    await session.command('EHLO plumtide-venue', '250');
    await session.command(`MAIL FROM:<${addressOf(config.mail.from)}>`, '250');
    await session.command(`RCPT TO:<${mail.to}>`, '250');
    await session.command('DATA', '354');
    session.write(`${message(mail).replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
    const stored = await session.read();
    if (!stored.startsWith('250')) throw new Error(`smtp data: ${stored.trim()}`);
    await session.command('QUIT', '221');
  } catch (error) {
    throw new ProviderUnreachable(PROVIDER, error);
  } finally {
    socket.destroy();
  }
}

export async function up(): Promise<boolean> {
  return new Promise((resolve) => {
    const connection = createConnection({ host: config.mail.host, port: config.mail.port });
    connection.setTimeout(2000);
    const finish = (value: boolean): void => {
      connection.destroy();
      resolve(value);
    };
    connection.once('connect', () => finish(true));
    connection.once('timeout', () => finish(false));
    connection.once('error', () => finish(false));
  });
}
