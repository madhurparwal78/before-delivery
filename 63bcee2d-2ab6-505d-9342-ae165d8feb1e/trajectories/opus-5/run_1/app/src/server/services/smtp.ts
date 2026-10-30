/**
 * The SMTP client. One message, one To recipient, no CC and no BCC, with the
 * tender calendar file carried as a single attachment.
 */

import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

export interface SmtpMessage {
  from: string;
  fromAddress: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachment?: { fileName: string; contentType: string; content: string };
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private queue: string[] = [];
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => this.absorb(chunk));
    this.socket.on('error', (error: Error) => {
      this.failure = error;
      this.waiting?.('');
    });
  }

  private absorb(chunk: string): void {
    this.buffer += chunk;
    // A reply ends on the line whose fourth character is a space.
    for (;;) {
      const match = /^(?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n/.exec(this.buffer);
      if (!match) return;
      this.buffer = this.buffer.slice(match[0].length);
      const reply = match[0];
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(reply);
      } else {
        this.queue.push(reply);
      }
    }
  }

  private async read(): Promise<string> {
    if (this.failure) throw this.failure;
    const queued = this.queue.shift();
    if (queued !== undefined) return queued;
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
    });
    if (this.failure) throw this.failure;
    return reply;
  }

  /** Sends one command and refuses any reply outside the expected codes. */
  async command(line: string | null, expected: readonly number[]): Promise<string> {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    const code = Number(reply.slice(0, 3));
    if (!expected.includes(code)) {
      throw new Error(`SMTP refused "${line ?? 'greeting'}": ${reply.trim()}`);
    }
    return reply;
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Lines(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let at = 0; at < encoded.length; at += 76) lines.push(encoded.slice(at, at + 76));
  return lines.join('\r\n');
}

function buildMime(message: SmtpMessage): string {
  const headers = [
    `From: ${encodeHeader(message.from)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@plumbline>`,
    'MIME-Version: 1.0',
  ];
  if (message.replyTo) headers.push(`Reply-To: ${message.replyTo}`);

  if (!message.attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${base64Lines(message.text)}\r\n`;
  }

  const boundary = `plumbline-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.text),
    `--${boundary}`,
    `Content-Type: ${message.attachment.contentType}; name="${message.attachment.fileName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${message.attachment.fileName}"`,
    '',
    base64Lines(message.attachment.content),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

export async function sendMail(
  options: { host: string; port: number },
  message: SmtpMessage,
): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connecting = createConnection({ host: options.host, port: options.port });
    connecting.setTimeout(10_000, () => {
      connecting.destroy(new Error('SMTP connection timed out'));
    });
    connecting.once('connect', () => {
      connecting.setTimeout(0);
      resolve(connecting);
    });
    connecting.once('error', reject);
  });

  const session = new SmtpSession(socket);
  try {
    await session.command(null, [220]);
    await session.command('EHLO plumbline', [250]);
    await session.command(`MAIL FROM:<${message.fromAddress}>`, [250]);
    await session.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await session.command('DATA', [354]);
    session.write(buildMime(message));
    await session.command('.', [250]);
    await session.command('QUIT', [221]).catch(() => undefined);
  } finally {
    session.end();
  }
}
