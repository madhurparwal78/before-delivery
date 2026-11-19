import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';
import { markService } from './health.js';

const CONNECT_TIMEOUT_MS = 5_000;
const REPLY_TIMEOUT_MS = 8_000;

const ADDRESS = /<([^>]+)>/;

/** The envelope sender taken from MAIL_FROM, which may carry a display name. */
function envelopeFrom(): string {
  const match = ADDRESS.exec(config.mailFrom);
  return match ? (match[1] as string) : config.mailFrom.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(to: string, subject: string, body: string): string {
  const headers = [
    `From: ${encodeHeader(config.mailFrom)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@dotgain>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const stuffed = body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${stuffed}\r\n`;
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private pending: ((reply: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
    });
    socket.on('close', () => {
      this.failure ??= new Error('SMTP connection closed');
    });
  }

  private drain(): void {
    if (this.pending === null) return;
    // A reply ends with a line whose fourth character is a space, not a hyphen.
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i += 1) {
      const line = lines[i] as string;
      if (line.length >= 4 && line[3] === '-') continue;
      const reply = lines.slice(0, i + 1).join('\r\n');
      this.buffer = lines.slice(i + 1).join('\r\n');
      const resolve = this.pending;
      this.pending = null;
      resolve?.(reply);
      return;
    }
  }

  async expect(prefixes: readonly string[], command?: string): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(() => reject(new Error('SMTP reply timed out')), REPLY_TIMEOUT_MS);
      this.pending = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.socket.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
      if (command !== undefined) this.socket.write(`${command}\r\n`);
      this.drain();
    });
    if (!prefixes.some((prefix) => reply.startsWith(prefix))) {
      throw new Error(`SMTP refused: ${reply.slice(0, 120)}`);
    }
  }

  write(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.destroy();
  }
}

async function connect(): Promise<SmtpSession> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const created = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const timer = setTimeout(() => {
      created.destroy();
      reject(new Error('SMTP connection timed out'));
    }, CONNECT_TIMEOUT_MS);
    created.once('connect', () => {
      clearTimeout(timer);
      resolve(created);
    });
    created.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return new SmtpSession(socket);
}

/** Sends one message. Resolves on a 250 from the server, throws on anything else. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  let session: SmtpSession | null = null;
  try {
    session = await connect();
    await session.expect(['220']);
    await session.expect(['250'], 'EHLO dotgain');
    await session.expect(['250'], `MAIL FROM:<${envelopeFrom()}>`);
    await session.expect(['250', '251'], `RCPT TO:<${to}>`);
    await session.expect(['354', '250'], 'DATA');
    session.write(buildMessage(to, subject, body));
    await session.expect(['250'], '.');
    session.write('QUIT\r\n');
    markService('email', 'up');
  } catch (error) {
    markService('email', 'down');
    throw error;
  } finally {
    session?.end();
  }
}

export async function probeEmail(): Promise<void> {
  let session: SmtpSession | null = null;
  try {
    session = await connect();
    await session.expect(['220']);
    await session.expect(['250'], 'EHLO dotgain');
    session.write('QUIT\r\n');
    markService('email', 'up');
  } catch {
    markService('email', 'down');
  } finally {
    session?.end();
  }
}
