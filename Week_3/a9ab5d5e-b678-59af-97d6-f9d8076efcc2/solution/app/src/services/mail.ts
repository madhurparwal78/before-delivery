import { Socket, createConnection } from 'node:net';
import { config } from '../config';

interface Letter {
  noticeId: string;
  to: string;
  subject: string;
  householdName: string;
  link: string;
}

function envelopeAddress(mailFrom: string): string {
  const match = /<([^>]+)>/.exec(mailFrom);
  return match ? (match[1] as string) : mailFrom;
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private buffer = '';
  private waiting: { expect: number; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.check();
    });
    socket.on('error', (error) => this.waiting?.reject(error));
    socket.on('close', () => this.waiting?.reject(new Error('SMTP connection closed')));
  }

  private check(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    for (const line of this.buffer.split('\r\n')) {
      if (!/^\d{3} /.test(line)) continue;
      const code = Number.parseInt(line.slice(0, 3), 10);
      this.buffer = '';
      this.waiting = null;
      if (code !== waiting.expect) waiting.reject(new Error(`SMTP answered ${line}`));
      else waiting.resolve();
      return;
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = { expect: code, resolve, reject };
      this.check();
    });
  }

  async send(command: string, code: number): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(code);
  }

  write(text: string): void {
    this.socket.write(text);
  }
}

/** The plain-text notice carries only the household name and one link. */
export async function deliver(letter: Letter): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: config.smtpHost, port: config.smtpPort, timeout: 5000 });
    connection.once('connect', () => resolve(connection));
    connection.once('timeout', () => {
      connection.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    connection.once('error', reject);
  });
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.send('EHLO twohouse.local', 250);
    await session.send(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, 250);
    await session.send(`RCPT TO:<${letter.to}>`, 250);
    await session.send('DATA', 354);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${letter.to}`,
      `Subject: ${encodeHeader(letter.subject)}`,
      `Message-ID: <${letter.noticeId}@twohouse.local>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const body = `${letter.householdName}: open Twohouse to see the details.\r\n${letter.link}\r\n`
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    session.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await session.expect(250);
    await session.send('QUIT', 221);
  } finally {
    socket.destroy();
  }
}
