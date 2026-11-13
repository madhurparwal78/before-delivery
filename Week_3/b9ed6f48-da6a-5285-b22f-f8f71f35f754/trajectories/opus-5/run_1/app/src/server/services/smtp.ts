import { Socket } from 'node:net';
import { config } from '../config.js';

const CONNECT_TIMEOUT_MS = 5_000;
const REPLY_TIMEOUT_MS = 10_000;

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? (match[1] as string) : from;
}

class SmtpSession {
  private buffer = '';
  private readonly socket: Socket;
  private pending: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.pending?.reject(error));
    socket.on('close', () => this.pending?.reject(new Error('SMTP connection closed')));
  }

  private drain(): void {
    const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(this.buffer);
    if (!match || !this.pending) return;
    const reply = this.buffer.slice(0, match[0].length);
    this.buffer = this.buffer.slice(match[0].length);
    const pending = this.pending;
    this.pending = null;
    pending.resolve(reply);
  }

  readReply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP reply timed out')), REPLY_TIMEOUT_MS);
      this.pending = {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.drain();
    });
  }

  async command(line: string, expected: number): Promise<string> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.readReply();
    const code = Number(/(\d{3}) [^\n]*\n$/.exec(reply)?.[1] ?? '0');
    if (code !== expected) throw new Error(`SMTP ${line.split(' ')[0]} answered ${reply.trim()}`);
    return reply;
  }

  writeRaw(text: string): void {
    this.socket.write(text);
  }

  close(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    }, CONNECT_TIMEOUT_MS);
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.connect(config.mail.port, config.mail.host, () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

function encodeHeader(value: string): string {
  /* eslint-disable-next-line no-control-regex */
  if (!/[^\x20-\x7e]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
}

export interface OutboundMessage {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}

/** Sends one message to Mailpit. Throws when Mailpit cannot be reached. */
export async function deliver(message: OutboundMessage): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.readReply();
    if (!greeting.startsWith('220')) throw new Error(`SMTP greeting was ${greeting.trim()}`);
    const ehlo = await session.command('EHLO sightline', 250);
    const eightBit = /8BITMIME/i.test(ehlo);
    const sender = envelopeAddress(config.mail.from);
    await session.command(`MAIL FROM:<${sender}>${eightBit ? ' BODY=8BITMIME' : ''}`, 250);
    await session.command(`RCPT TO:<${message.recipientEmail}>`, 250);
    await session.command('DATA', 354);
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${encodeHeader(message.recipientName)} <${message.recipientEmail}>`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Content-Transfer-Encoding: ${eightBit ? '8bit' : 'base64'}`,
    ].join('\r\n');
    const payload = eightBit ? dotStuff(message.body) : Buffer.from(message.body, 'utf8').toString('base64');
    session.writeRaw(`${headers}\r\n\r\n${payload}\r\n.\r\n`);
    const stored = await session.readReply();
    if (!stored.startsWith('250')) throw new Error(`SMTP DATA answered ${stored.trim()}`);
    session.writeRaw('QUIT\r\n');
  } finally {
    session.close();
  }
}

export async function reachable(): Promise<boolean> {
  try {
    const socket = await connect();
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}
