import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

/** Mailpit is plain SMTP with no authentication and no TLS. */
export interface SmtpAddress {
  name: string;
  address: string;
}

export interface SmtpMessage {
  from: SmtpAddress;
  to: string;
  subject: string;
  text: string;
}

export interface SmtpOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    const fail = (error: Error): void => this.failure?.(error);
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('smtp connection closed')));
  }

  /** SMTP replies end with a line whose fourth character is a space. */
  private drain(): void {
    const match = /(^|\n)(\d{3}) [^\n]*\n/.exec(this.buffer);
    if (match === null || this.waiting === null) return;
    const reply = this.buffer.slice(0, match.index + match[0].length);
    this.buffer = this.buffer.slice(match.index + match[0].length);
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  async expect(prefix: string): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      this.waiting = resolve;
      this.failure = reject;
      this.drain();
    });
    const code = /(\d{3}) [^\n]*\n?$/.exec(reply.trim())?.[1] ?? reply.slice(0, 3);
    if (!code.startsWith(prefix)) throw new Error(`smtp refused: ${reply.trim()}`);
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  close(): void {
    this.socket.destroy();
  }
}

function connect(options: SmtpOptions): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: options.host, port: options.port });
    socket.setTimeout(options.timeoutMs, () => {
      socket.destroy();
      reject(new Error('smtp timed out'));
    });
    socket.once('error', reject);
    socket.once('connect', () => resolve(new SmtpSession(socket)));
  });
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('smtp timed out')), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('smtp failed'));
      },
    );
  });
}

function dotStuff(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function compose(message: SmtpMessage): string {
  const headers = [
    `From: ${message.from.name} <${message.from.address}>`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@wobblewell.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${dotStuff(message.text)}`;
}

/** Opens a session, greets the server and hangs up. */
export async function probe(options: SmtpOptions): Promise<boolean> {
  try {
    await withTimeout(
      (async () => {
        const session = await connect(options);
        try {
          await session.expect('220');
          session.send('EHLO pratfall-cup');
          await session.expect('250');
          session.send('QUIT');
        } finally {
          session.close();
        }
      })(),
      options.timeoutMs,
    );
    return true;
  } catch {
    return false;
  }
}

export async function send(options: SmtpOptions, message: SmtpMessage): Promise<boolean> {
  try {
    await withTimeout(
      (async () => {
        const session = await connect(options);
        try {
          await session.expect('220');
          session.send('EHLO pratfall-cup');
          await session.expect('250');
          session.send(`MAIL FROM:<${message.from.address}>`);
          await session.expect('250');
          session.send(`RCPT TO:<${message.to}>`);
          await session.expect('250');
          session.send('DATA');
          await session.expect('354');
          session.send(`${compose(message)}\r\n.`);
          await session.expect('250');
          session.send('QUIT');
        } finally {
          session.close();
        }
      })(),
      options.timeoutMs,
    );
    return true;
  } catch {
    return false;
  }
}
