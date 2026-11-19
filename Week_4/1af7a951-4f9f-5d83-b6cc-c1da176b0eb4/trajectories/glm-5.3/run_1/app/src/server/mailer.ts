import { connect, type Socket } from 'node:net';
import { ApiError, mailUnavailable } from '../shared/errors.js';

// Plain SMTP client without authentication. Messages are visible in Mailpit.

const CONNECT_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 5_000;

class SmtpSession {
  private buffer = '';

  constructor(private readonly socket: Socket) {}

  static open(host: string, port: number): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(mailUnavailable());
      }, CONNECT_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(new SmtpSession(socket));
      });
      socket.once('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(err.code === 'ECONNREFUSED' ? mailUnavailable() : err);
      });
    });
  }

  // Resolves on a complete reply: a line whose fourth char is a space.
  private readReply(): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
        reject(mailUnavailable());
      }, COMMAND_TIMEOUT_MS);
      const onData = (chunk: Buffer): void => {
        this.buffer += chunk.toString('binary');
        for (;;) {
          const idx = this.buffer.indexOf('\r\n');
          if (idx === -1) return;
          const line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 2);
          const m = /^(\d{3})(.)/.exec(line);
          if (m && m[2] === ' ') {
            clearTimeout(timer);
            this.socket.off('data', onData);
            this.socket.off('error', onErr);
            resolve(Number(m[1]));
            return;
          }
          if (m && m[2] === '-') continue;
          clearTimeout(timer);
          this.socket.destroy();
          reject(mailUnavailable());
          return;
        }
      };
      const onErr = (): void => {
        clearTimeout(timer);
        reject(mailUnavailable());
      };
      this.socket.on('data', onData);
      this.socket.once('error', onErr);
    });
  }

  async expect(): Promise<number> {
    return this.readReply();
  }

  async run(text: string): Promise<number> {
    this.socket.write(`${text}\r\n`);
    return this.readReply();
  }

  async data(raw: string): Promise<number> {
    this.socket.write(`${raw.replace(/^\./gm, '..')}\r\n.\r\n`);
    return this.readReply();
  }

  close(): void {
    this.socket.destroy();
  }
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export class Mailer {
  constructor(private readonly host: string, private readonly port: number) {}

  async send(message: MailMessage): Promise<void> {
    let session: SmtpSession;
    try {
      session = await SmtpSession.open(this.host, this.port);
    } catch (err) {
      throw toOutage(err);
    }
    try {
      const greet = await session.expect();
      if (greet !== 220) throw mailUnavailable();
      if ((await session.run('EHLO lanternfish')) !== 250) throw mailUnavailable();
      if ((await session.run(`MAIL FROM:<${extractAddress(message.from)}>`)) !== 250) throw mailUnavailable();
      if ((await session.run(`RCPT TO:<${message.to}>`)) !== 250) throw mailUnavailable();
      if ((await session.run('DATA')) !== 354) throw mailUnavailable();
      if ((await session.data(renderMessage(message))) !== 250) throw mailUnavailable();
      await session.run('QUIT');
      session.close();
    } catch (err) {
      session.close();
      throw toOutage(err);
    }
  }
}

function toOutage(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  return mailUnavailable();
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? (m[1] as string) : from;
}

export function renderMessage(message: MailMessage): string {
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${message.body}`;
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += 60) parts.push(b64.slice(i, i + 60));
  return `=?utf-8?B?${parts.join('?= =?utf-8?B?')}?=`;
}
