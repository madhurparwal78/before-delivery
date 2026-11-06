import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { env, mailFromAddress } from '../env.ts';

const TIMEOUT_MS = 3000;

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers: Record<string, string>;
};

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
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.flush();
    });
    socket.on('close', () => {
      this.failure = this.failure ?? new Error('smtp connection closed');
      this.flush();
    });
  }

  private flush(): void {
    if (this.waiting === null) return;
    const match = /^(?:\d{3}-[^\n]*\n)*(\d{3} [^\n]*)\r?\n/.exec(this.buffer);
    if (match !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      this.buffer = this.buffer.slice(match[0].length);
      resolve(match[1]);
      return;
    }
    if (this.failure !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('421 connection lost');
    }
  }

  async expect(prefix: string): Promise<void> {
    const line = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
    if (!line.startsWith(prefix)) throw new Error(`smtp: expected ${prefix}, got ${line}`);
  }

  send(command: string): void {
    this.socket.write(`${command}\r\n`);
  }

  sendRaw(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Body(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) lines.push(encoded.slice(index, index + 76));
  return lines.join('\r\n');
}

function buildMessage(message: MailMessage): string {
  const boundary = `halide-${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${env.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    ...Object.entries(message.headers).map(([name, value]) => `${name}: ${encodeHeader(value)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(message.html),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

async function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.smtp.host, port: env.smtp.port });
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(TIMEOUT_MS, () => fail(new Error('smtp timeout')));
    socket.once('connect', () => {
      socket.setTimeout(TIMEOUT_MS);
      resolve(socket);
    });
    socket.once('error', fail);
  });
}

export async function sendMail(message: MailMessage): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.send('EHLO halide-box-office');
    await session.expect('250');
    session.send(`MAIL FROM:<${mailFromAddress}>`);
    await session.expect('250');
    session.send(`RCPT TO:<${message.to}>`);
    await session.expect('250');
    session.send('DATA');
    await session.expect('354');
    session.sendRaw(`${buildMessage(message)}\r\n.\r\n`);
    await session.expect('250');
    session.send('QUIT');
  } finally {
    session.close();
  }
}

export async function probeSmtp(): Promise<boolean> {
  try {
    const socket = await connect();
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}
