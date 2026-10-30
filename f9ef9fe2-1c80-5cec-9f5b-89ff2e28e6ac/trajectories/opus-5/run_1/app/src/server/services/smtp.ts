import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { MAIL_SENDER, env } from '../env.js';

const TIMEOUT_MS = 10000;
const SENDER_ADDRESS = 'no-reply@pilotlight.test';

interface Reply {
  code: number;
  text: string;
}

/** A plain SMTP conversation: no authentication, no TLS, one recipient. */
class SmtpConversation {
  private buffer = '';
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new Error('SMTP timed out')));
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting) waiting.reject(error);
  }

  private deliver(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    for (const [index, line] of lines.entries()) {
      if (!/^\d{3} /.test(line)) continue;
      const consumed = lines.slice(0, index + 1).join('\r\n').length + 2;
      const text = this.buffer.slice(0, consumed).trim();
      this.buffer = this.buffer.slice(consumed);
      const waiting = this.waiting;
      this.waiting = null;
      waiting.resolve({ code: Number(line.slice(0, 3)), text });
      return;
    }
  }

  private nextReply(): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<Reply>((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.deliver();
    });
  }

  async expect(expected: number[]): Promise<Reply> {
    const reply = await this.nextReply();
    if (!expected.includes(reply.code)) {
      throw new Error(`SMTP answered ${reply.code} where ${expected.join(' or ')} was expected`);
    }
    return reply;
  }

  async command(line: string, expected: number[]): Promise<Reply> {
    this.socket.write(`${line}\r\n`);
    return this.expect(expected);
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<SmtpConversation> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.smtp.host, port: env.smtp.port });
    const onError = (error: Error): void => reject(error);
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(new SmtpConversation(socket));
    });
  });
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Body(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let at = 0; at < encoded.length; at += 76) lines.push(encoded.slice(at, at + 76));
  return lines.join('\r\n');
}

function buildMessage(to: string, subject: string, text: string): string {
  const headers = [
    `From: ${MAIL_SENDER}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@pilotlight.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${base64Body(text)}\r\n`;
}

export async function sendMessage(to: string, subject: string, text: string): Promise<void> {
  const session = await connect();
  try {
    await session.expect([220]);
    await session.command('EHLO pilotlight', [250]);
    await session.command(`MAIL FROM:<${SENDER_ADDRESS}>`, [250]);
    await session.command(`RCPT TO:<${to}>`, [250, 251]);
    await session.command('DATA', [354]);
    session.write(buildMessage(to, subject, text));
    await session.command('.', [250]);
    await session.command('QUIT', [221]);
  } finally {
    session.end();
  }
}

export async function probeMail(): Promise<void> {
  const session = await connect();
  try {
    await session.expect([220]);
    await session.command('NOOP', [250]);
    await session.command('QUIT', [221]);
  } finally {
    session.end();
  }
}
