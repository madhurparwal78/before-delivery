import { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { env } from '../env';

export interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    if (!this.waiting) return;
    // A reply ends with a line whose fourth character is a space, such as "250 OK".
    const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\r?\n/.exec(this.buffer);
    if (!match) return;
    const reply = this.buffer.slice(0, match[0].length);
    this.buffer = this.buffer.slice(match[0].length);
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('smtp timeout')), 5000);
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.drain();
    });
  }

  write(line: string): void {
    this.socket.write(line);
  }

  async command(line: string, expected: string): Promise<void> {
    this.write(`${line}\r\n`);
    const reply = await this.read();
    if (!reply.startsWith(expected)) throw new Error(`smtp refused ${line}: ${reply.trim()}`);
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(5000);
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('smtp timeout'));
    });
    socket.connect(env.mail.port, env.mail.host, () => resolve(socket));
  });
}

function senderAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function sendMessage(message: OutgoingMessage): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.read();
    if (!greeting.startsWith('220')) throw new Error(`smtp greeting: ${greeting.trim()}`);
    await session.command('EHLO furrowbook', '250');
    await session.command(`MAIL FROM:<${senderAddress(env.mail.from)}>`, '250');
    await session.command(`RCPT TO:<${message.to}>`, '250');
    await session.command('DATA', '354');
    const headers = [
      `From: ${encodeHeader(env.mail.from)}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@furrowbook>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    session.write(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    const stored = await session.read();
    if (!stored.startsWith('250')) throw new Error(`smtp rejected the message: ${stored.trim()}`);
    await session.command('QUIT', '221');
  } finally {
    socket.destroy();
  }
}

export async function smtpIsUp(): Promise<boolean> {
  try {
    const socket = await connect();
    const session = new SmtpSession(socket);
    try {
      const greeting = await session.read();
      if (!greeting.startsWith('220')) return false;
      await session.command('QUIT', '221');
      return true;
    } finally {
      socket.destroy();
    }
  } catch {
    return false;
  }
}
