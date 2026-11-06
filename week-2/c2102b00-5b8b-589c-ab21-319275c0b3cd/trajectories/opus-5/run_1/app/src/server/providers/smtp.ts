import net from 'node:net';
import { config } from '../config.ts';

const TIMEOUT_MS = 10_000;

/** RFC 2047 encoded words, never splitting a code point between words. */
export function encodeHeaderValue(value: string): string {
  if (!/[^\u0000-\u007f]/.test(value)) return value;
  const words: string[] = [];
  let chunk: string[] = [];
  let bytes = 0;
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, 'utf8');
    if (bytes + size > 42 && chunk.length > 0) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk.join(''), 'utf8').toString('base64')}?=`);
      chunk = [];
      bytes = 0;
    }
    chunk.push(codePoint);
    bytes += size;
  }
  if (chunk.length > 0) {
    words.push(`=?UTF-8?B?${Buffer.from(chunk.join(''), 'utf8').toString('base64')}?=`);
  }
  return words.join('\r\n ');
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match ? (match[1] ?? '') : config.mail.from;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

function buildData(message: OutgoingMessage): string {
  const lines = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...message.body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
  ];
  return `${lines.join('\r\n')}\r\n.\r\n`;
}

class SmtpSession {
  private buffer = '';
  private waiting: { resolve: (code: number) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }

  private deliver(): void {
    if (!this.waiting) return;
    const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(this.buffer);
    if (!match) return;
    this.buffer = this.buffer.slice(match[0].length);
    const waiting = this.waiting;
    this.waiting = null;
    waiting.resolve(Number(match[1]));
  }

  async expect(codes: number[]): Promise<void> {
    const code = await new Promise<number>((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      this.waiting = { resolve, reject };
      this.deliver();
    });
    if (!codes.includes(code)) throw new Error(`smtp replied ${code}`);
  }

  write(line: string): void {
    this.socket.write(line);
  }

  end(): void {
    this.socket.removeAllListeners('close');
    this.socket.destroy();
  }
}

export async function sendMessage(message: OutgoingMessage): Promise<void> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const candidate = net.createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new Error('smtp connect timed out'));
    }, TIMEOUT_MS);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy());
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    session.write('EHLO tally-split\r\n');
    await session.expect([250]);
    session.write(`MAIL FROM:<${fromAddress()}>\r\n`);
    await session.expect([250]);
    session.write(`RCPT TO:<${message.to}>\r\n`);
    await session.expect([250, 251]);
    session.write('DATA\r\n');
    await session.expect([354]);
    session.write(buildData(message));
    await session.expect([250]);
    session.write('QUIT\r\n');
  } finally {
    session.end();
  }
}
