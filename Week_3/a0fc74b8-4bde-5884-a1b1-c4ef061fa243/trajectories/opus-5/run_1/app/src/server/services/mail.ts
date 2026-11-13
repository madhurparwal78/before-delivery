import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';

const CONNECT_TIMEOUT_MS = 5000;
const REPLY_TIMEOUT_MS = 5000;

export class MailUnavailable extends Error {}

/** Each run of carriage returns and line feeds becomes one space. */
export const headerSafe = (text: string): string => text.replace(/[\r\n]+/g, ' ');

const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);

const encodeHeaderValue = (text: string): string => {
  const safe = headerSafe(text);
  return isAscii(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
};

export interface Address {
  name: string | null;
  email: string;
}

export const parseAddress = (raw: string): Address => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (match) {
    const name = (match[1] ?? '').trim();
    return { name: name === '' ? null : name, email: (match[2] ?? '').trim() };
  }
  return { name: null, email: raw.trim() };
};

export const formatAddress = (address: Address): string => {
  if (address.name === null) return address.email;
  const safe = headerSafe(address.name);
  const display = isAscii(safe) ? `"${safe.replace(/["\\]/g, '')}"` : encodeHeaderValue(safe);
  return `${display} <${address.email}>`;
};

export interface Message {
  from: string;
  to: string;
  subject: string;
  body: string;
}

const replyCode = (reply: string): number => {
  const lines = reply.trim().split(/\r?\n/);
  const last = lines[lines.length - 1] ?? '';
  return Number.parseInt(last.slice(0, 3), 10);
};

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      const waiting = this.waiting;
      this.waiting = null;
      waiting?.reject(error);
    });
  }

  private drain(): void {
    if (!this.waiting) return;
    const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
    if (!match) return;
    this.buffer = this.buffer.slice(match[0].length);
    const waiting = this.waiting;
    this.waiting = null;
    waiting.resolve(match[0]);
  }

  async expect(codes: readonly number[]): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error('SMTP reply timed out'));
      }, REPLY_TIMEOUT_MS);
      this.waiting = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.drain();
    });
    if (!codes.includes(replyCode(reply))) throw new Error(`SMTP replied ${reply.trim()}`);
  }

  write(payload: string): void {
    this.socket.write(`${payload}\r\n`);
  }

  end(): void {
    this.socket.destroy();
  }
}

const connect = (): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP connect timed out'));
    }, CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const rfc2822Date = (at: Date): string => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${days[at.getUTCDay()]}, ${pad(at.getUTCDate())} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} +0000`;
};

const buildMime = (message: Message): string => {
  const headers = [
    `From: ${formatAddress(parseAddress(message.from))}`,
    `To: ${headerSafe(message.to)}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${rfc2822Date(new Date())}`,
    `Message-ID: <${randomUUID()}@wickmoor.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = message.body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
};

export const sendMail = async (message: Message): Promise<void> => {
  let socket: Socket;
  try {
    socket = await connect();
  } catch (error) {
    throw new MailUnavailable(error instanceof Error ? error.message : 'mail unreachable');
  }
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    session.write('EHLO undersign');
    await session.expect([250]);
    session.write(`MAIL FROM:<${parseAddress(message.from).email}>`);
    await session.expect([250]);
    session.write(`RCPT TO:<${parseAddress(message.to).email}>`);
    await session.expect([250, 251]);
    session.write('DATA');
    await session.expect([354]);
    session.write(buildMime(message));
    session.write('.');
    await session.expect([250]);
    session.write('QUIT');
  } catch (error) {
    throw new MailUnavailable(error instanceof Error ? error.message : 'mail failed');
  } finally {
    session.end();
  }
};

export const checkMail = async (): Promise<boolean> => {
  let socket: Socket;
  try {
    socket = await connect();
  } catch {
    return false;
  }
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    session.write('QUIT');
    return true;
  } catch {
    return false;
  } finally {
    session.end();
  }
};
