import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

export class MailRelayUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('mail relay unavailable');
    this.name = 'MailRelayUnavailableError';
    this.cause = cause;
  }
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.failed?.(error));
    socket.on('close', () => this.failed?.(new Error('connection closed')));
    socket.setTimeout(8000, () => socket.destroy());
  }

  private flush(): void {
    while (this.pending) {
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
      if (!match) return;
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const resolve = this.pending;
      this.pending = null;
      resolve(reply);
    }
  }

  async expect(prefixes: string[]): Promise<string> {
    const reply = await new Promise<string>((resolve, reject) => {
      this.pending = resolve;
      this.failed = reject;
      this.flush();
    });
    const lastLine = reply.trimEnd().split('\n').pop() ?? '';
    if (!prefixes.some((prefix) => lastLine.startsWith(prefix))) {
      throw new MailRelayUnavailableError(`unexpected SMTP reply: ${lastLine}`);
    }
    return reply;
  }

  send(command: string): void {
    this.socket.write(`${command}\r\n`);
  }

  end(): void {
    this.socket.end();
  }
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(mail: OutgoingMail): string {
  const boundary = `hangline-${randomUUID()}`;
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@ashgrove-museum.example>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    mail.text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    mail.html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return `${headers}\r\n\r\n${parts}`;
}

function dotStuff(message: string): string {
  return message
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

async function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(4000);
    const fail = (error: Error): void => {
      socket.destroy();
      reject(new MailRelayUnavailableError(error));
    };
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('timeout')));
    socket.once('connect', () => {
      socket.removeListener('error', fail);
      resolve(socket);
    });
  });
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect(['220']);
    session.send('EHLO hangline');
    await session.expect(['250']);
    session.send(`MAIL FROM:<${envelopeAddress(config.mail.from)}>`);
    await session.expect(['250']);
    session.send(`RCPT TO:<${mail.to}>`);
    await session.expect(['250', '251']);
    session.send('DATA');
    await session.expect(['354']);
    socket.write(`${dotStuff(buildMessage(mail))}\r\n.\r\n`);
    await session.expect(['250']);
    session.send('QUIT');
  } catch (error) {
    if (error instanceof MailRelayUnavailableError) throw error;
    throw new MailRelayUnavailableError(error);
  } finally {
    session.end();
  }
}

export async function probeMailRelay(): Promise<boolean> {
  try {
    const socket = await connect();
    const session = new SmtpSession(socket);
    try {
      await session.expect(['220']);
      session.send('QUIT');
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
