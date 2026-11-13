import { createConnection, type Socket } from 'node:net';
import { env } from '../env.js';

const SOCKET_TIMEOUT_MS = 8_000;

class SmtpSession {
  private buffer = '';
  private pending: { resolve: (lines: string) => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.pending?.reject(error));
    socket.on('close', () => this.pending?.reject(new Error('SMTP connection closed')));
  }

  private flush(): void {
    if (this.pending === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] as string;
      if (/^\d{3} /.test(line)) {
        const complete = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        const pending = this.pending;
        this.pending = null;
        pending.resolve(complete);
        return;
      }
    }
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.flush();
    });
  }

  async command(text: string, expected: number): Promise<void> {
    this.socket.write(`${text}\r\n`);
    await this.expect(expected);
  }

  async expect(expected: number): Promise<void> {
    const reply = await this.read();
    const lines = reply.split('\r\n').filter((line) => line.length > 0);
    const code = Number((lines[lines.length - 1] ?? '').slice(0, 3));
    if (Math.floor(code / 100) !== Math.floor(expected / 100)) {
      throw new Error(`SMTP refused: ${reply.trim()}`);
    }
  }

  write(text: string): void {
    this.socket.write(text);
  }

  end(): void {
    this.socket.end();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.smtp.host, port: env.smtp.port });
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => {
      socket.destroy(new Error('SMTP timeout'));
    });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match ? (match[1] as string) : mailbox.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\u0020-\u007e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(to: string, subject: string, body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  const wrapped = (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
  return [
    `From: ${env.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
    '',
  ].join('\r\n');
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.command('EHLO crosshand-relay', 250);
    await session.command(`MAIL FROM:<${addressOf(env.smtp.from)}>`, 250);
    await session.command(`RCPT TO:<${addressOf(to)}>`, 250);
    await session.command('DATA', 354);
    session.write(buildMessage(to, subject, body));
    session.write('.\r\n');
    await session.expect(250);
    await session.command('QUIT', 221);
  } finally {
    session.end();
  }
}
