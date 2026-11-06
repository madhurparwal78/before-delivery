import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

const MAIL_TIMEOUT_MS = 4000;

export class MailUnavailable extends Error {}

export interface Message {
  readonly to: readonly string[];
  readonly subject: string;
  readonly lines: readonly string[];
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from.trim();
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new MailUnavailable('mail sink closed the connection')));
  }

  private fail(error: Error): void {
    this.failure = error;
    this.drain();
  }

  private drain(): void {
    if (this.pending === null) return;
    if (this.failure !== null) {
      const resolve = this.pending;
      this.pending = null;
      resolve('');
      return;
    }
    const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(this.buffer);
    if (match === null) return;
    this.buffer = this.buffer.slice(match[0].length);
    const resolve = this.pending;
    this.pending = null;
    resolve(match[1]!);
  }

  async expect(codes: readonly string[]): Promise<void> {
    const code = await new Promise<string>((resolve) => {
      this.pending = resolve;
      this.drain();
    });
    if (this.failure !== null) throw this.failure;
    if (!codes.includes(code)) {
      throw new MailUnavailable(`mail sink answered ${code}`);
    }
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  end(): void {
    this.socket.destroy();
  }
}

/** Sends one message, resolving only once the sink has accepted it. */
export async function sendMail(message: Message): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.mail.host, port: config.mail.port });
    candidate.setTimeout(MAIL_TIMEOUT_MS);
    candidate.once('connect', () => resolve(candidate));
    candidate.once('timeout', () => {
      candidate.destroy();
      reject(new MailUnavailable('mail sink timed out'));
    });
    candidate.once('error', (error) => reject(new MailUnavailable(error.message)));
  });
  const session = new SmtpSession(socket);
  const sender = addressOf(config.mail.from);
  try {
    await session.expect(['220']);
    session.write('EHLO fluxseal');
    await session.expect(['250']);
    session.write(`MAIL FROM:<${sender}>`);
    await session.expect(['250']);
    for (const recipient of message.to) {
      session.write(`RCPT TO:<${recipient}>`);
      await session.expect(['250', '251']);
    }
    session.write('DATA');
    await session.expect(['354']);
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${message.to.join(', ')}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ];
    const body = message.lines.map((line) => (line.startsWith('.') ? `.${line}` : line));
    session.write([...headers, '', ...body, '.'].join('\r\n'));
    await session.expect(['250']);
    session.write('QUIT');
  } finally {
    session.end();
  }
}
