import net from 'node:net';
import { config } from './config';
import { ApiError } from './errors';

let up = false;

export function isMailpitUp(): boolean {
  return up;
}

interface Envelope {
  to: string;
  subject: string;
  body: string;
}

class SmtpSession {
  private readonly socket: net.Socket;
  private buffer = '';
  private waiting: { resolve: (line: string) => void; reject: (cause: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (cause: Error) => this.fail(cause));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(cause: Error): void {
    this.failure = cause;
    this.waiting?.reject(cause);
    this.waiting = null;
  }

  private drain(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] as string;
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(index + 1).join('\r\n');
        const waiting = this.waiting;
        this.waiting = null;
        waiting.resolve(line);
        return;
      }
    }
  }

  reply(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.drain();
    });
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  async expect(prefix: string): Promise<void> {
    const line = await this.reply();
    if (!line.startsWith(prefix)) throw new Error(`smtp said ${line}`);
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(4000);
    const onError = (cause: Error): void => {
      socket.destroy();
      reject(cause);
    };
    socket.once('error', onError);
    socket.once('timeout', () => onError(new Error('smtp timeout')));
    socket.once('connect', () => {
      socket.off('error', onError);
      socket.setTimeout(0);
      resolve(new SmtpSession(socket));
    });
  });
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match ? (match[1] as string) : mailbox;
}

function message(envelope: Envelope): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${envelope.to}`,
    `Subject: ${envelope.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Date: ${new Date().toUTCString()}`,
  ];
  const body = envelope.body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n.\r\n`;
}

/** Hands the message to Mailpit, or reports MAIL_UNAVAILABLE. */
async function deliver(envelope: Envelope): Promise<void> {
  let session: SmtpSession;
  try {
    session = await connect();
  } catch {
    up = false;
    throw new ApiError('MAIL_UNAVAILABLE');
  }
  try {
    await session.expect('220');
    session.send('EHLO seam');
    await session.expect('250');
    session.send(`MAIL FROM:<${addressOf(config.mailFrom)}>`);
    await session.expect('250');
    session.send(`RCPT TO:<${envelope.to}>`);
    await session.expect('250');
    session.send('DATA');
    await session.expect('354');
    session.write(message(envelope));
    await session.expect('250');
    session.send('QUIT');
    up = true;
  } catch {
    up = false;
    throw new ApiError('MAIL_UNAVAILABLE');
  } finally {
    session.end();
  }
}

export async function sendConfirmation(to: string, origin: string, token: string): Promise<void> {
  await deliver({
    to,
    subject: 'Confirm your email for Seam',
    body: [
      'Welcome to Seam.',
      '',
      `Confirm your email: ${origin}/verify/${token}`,
      '',
      `This link works once and expires in ${config.verifyTtlMinutes} minutes.`,
    ].join('\n'),
  });
}

export async function sendReset(to: string, origin: string, token: string): Promise<void> {
  await deliver({
    to,
    subject: 'Reset your Seam password',
    body: [
      'Choose a new password for Seam.',
      '',
      `${origin}/reset/${token}`,
      '',
      `This link works once and expires in ${config.resetTtlMinutes} minutes.`,
    ].join('\n'),
  });
}

/** Checks that Mailpit is listening, for the health report. */
export async function probeMailpit(): Promise<void> {
  try {
    const session = await connect();
    await session.expect('220');
    session.send('QUIT');
    session.end();
    up = true;
  } catch {
    up = false;
  }
}

export function assertMailReachable(): void {
  if (!up) throw new ApiError('MAIL_UNAVAILABLE');
}
