/**
 * Margin and liquidation notices over SMTP. Bodies carry desk-format figures,
 * so the message is sent as UTF-8 base64 with an encoded-word subject.
 */

import { createConnection, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { config } from '../config.ts';

export class MailUnreachable extends Error {
  constructor(cause: string) {
    super(`The mail server is unreachable: ${cause}`);
    this.name = 'MailUnreachable';
  }
}

const CONNECT_TIMEOUT_MS = 4000;
const REPLY_TIMEOUT_MS = 4000;

/** The bare address inside a `Name <address>` From line. */
function envelopeAddress(mailFrom: string): string {
  const angled = /<([^>]+)>/.exec(mailFrom);
  return angled?.[1]?.trim() ?? mailFrom.trim();
}

function isAscii(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(text);
}

/** RFC 2047 encoded-word, used when a subject carries non-ASCII figures. */
function encodeHeaderValue(value: string): string {
  if (isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function foldBase64(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

/** A minimal SMTP conversation, held open only for one message. */
class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private pending: {
    resolve: (reply: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.fail(new MailUnreachable(error.message)));
    socket.on('close', () => this.fail(new MailUnreachable('connection closed')));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.pending;
    if (waiting !== null) {
      this.pending = null;
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
  }

  /** A reply is complete when its last line has a space after the code. */
  private drain(): void {
    const waiting = this.pending;
    if (waiting === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined || line.length < 4) continue;
      if (line[3] === ' ') {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        this.pending = null;
        clearTimeout(waiting.timer);
        waiting.resolve(reply);
        return;
      }
    }
  }

  private readReply(): Promise<string> {
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new MailUnreachable('timed out waiting for a reply')),
        REPLY_TIMEOUT_MS,
      );
      this.pending = { resolve, reject, timer };
      this.drain();
    });
  }

  /** Sends a command and requires one of the expected reply codes. */
  async command(line: string | null, expected: readonly string[]): Promise<string> {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.readReply();
    const code = reply.slice(0, 3);
    if (!expected.includes(code)) {
      throw new MailUnreachable(
        `expected ${expected.join('/')} but the server said ${reply.trim()}`,
      );
    }
    return reply;
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new MailUnreachable('connection timed out'));
    }, CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(new MailUnreachable(error.message));
    });
  });
}

export interface Notice {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
}

/** Delivers one notice. Resolves only once the mail server has accepted it. */
export async function sendNotice(notice: Notice): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.command(null, ['220']);
    await session.command(`EHLO ${hostname()}`, ['250']);
    await session.command(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, ['250']);
    await session.command(`RCPT TO:<${notice.recipient}>`, ['250', '251']);
    await session.command('DATA', ['354']);

    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${notice.recipient}`,
      `Subject: ${encodeHeaderValue(notice.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n');

    // Base64 lines can never begin with a dot, so no dot-stuffing is needed.
    await session.command(`${headers}\r\n\r\n${foldBase64(notice.body)}\r\n.`, ['250']);
    await session.command('QUIT', ['221']);
  } finally {
    session.end();
  }
}
