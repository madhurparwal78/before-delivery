import { createConnection, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { ProviderDownError, PROVIDER_TIMEOUT_MS } from './providers';

export interface MailAttachment {
  fileName: string;
  contentType: string;
  body: Buffer;
}

export interface Message {
  to: string;
  subject: string;
  text: string;
  attachment?: MailAttachment;
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(body: Buffer): string {
  const text = body.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < text.length; index += 76) lines.push(text.slice(index, index + 76));
  return lines.join('\r\n');
}

function buildMessage(message: Message): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@nightroll>`,
    'MIME-Version: 1.0',
  ];
  if (!message.attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8');
    return `${headers.join('\r\n')}\r\n\r\n${message.text.replace(/\n/g, '\r\n')}\r\n`;
  }
  const boundary = `nightroll-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.text.replace(/\n/g, '\r\n'),
    `--${boundary}`,
    `Content-Type: ${message.attachment.contentType}; name="${message.attachment.fileName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${message.attachment.fileName}"`,
    '',
    wrapBase64(message.attachment.body),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

function dotStuff(body: string): string {
  return body.replace(/^\./gm, '..');
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return match ? match[1] : config.mailFrom.trim();
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
      this.drain();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.drain();
    });
    socket.on('close', () => {
      if (!this.failure) this.failure = new Error('connection closed');
      this.drain();
    });
  }

  private drain(): void {
    if (!this.waiting) return;
    const match = /^(?:\d{3}-[^\n]*\n)*(\d{3} [^\n]*)\n/.exec(this.buffer.replace(/\r/g, ''));
    if (match) {
      const index = this.buffer.indexOf('\n', this.buffer.indexOf(match[1]));
      this.buffer = this.buffer.slice(index + 1);
      const resolve = this.waiting;
      this.waiting = null;
      resolve(match[1]);
      return;
    }
    if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('000 connection lost');
    }
  }

  private readReply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
  }

  async expect(prefix: string): Promise<void> {
    const reply = await this.readReply();
    if (!reply.startsWith(prefix)) {
      throw new ProviderDownError('smtp', `expected ${prefix}, got ${reply}`);
    }
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(PROVIDER_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new ProviderDownError('smtp', 'connect timed out'));
    });
    socket.once('connect', () => {
      socket.setTimeout(PROVIDER_TIMEOUT_MS);
      resolve(socket);
    });
    socket.once('error', (error) => reject(new ProviderDownError('smtp', String(error))));
  });
}

/** Hands the message to the mail provider and resolves only once it accepts it. */
export async function sendMessage(message: Message): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.send('EHLO nightroll');
    await session.expect('250');
    session.send(`MAIL FROM:<${senderAddress()}>`);
    await session.expect('250');
    session.send(`RCPT TO:<${message.to}>`);
    await session.expect('250');
    session.send('DATA');
    await session.expect('354');
    session.send(`${dotStuff(buildMessage(message))}\r\n.`);
    await session.expect('250');
    session.send('QUIT');
  } finally {
    session.end();
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const socket = await connect();
    const session = new SmtpSession(socket);
    try {
      await session.expect('220');
      session.send('QUIT');
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}

export const mailTexts = {
  checkinSubject: (hotelName: string): string => `Check in for your stay at ${hotelName}`,
  checkinBody: (url: string): string => `Check in here: ${url}`,
  invoiceSubject: (invoiceNumber: string, hotelName: string): string =>
    `Invoice ${invoiceNumber} from ${hotelName}`,
  invoiceBody: (invoiceNumber: string): string => `Your invoice ${invoiceNumber} is attached.`,
} as const;
