/**
 * A plain SMTP sender for Mailpit: no authentication and no TLS, which is all the shop's
 * mail relay offers. Every mail is text only, UTF-8, sent base64 so accents survive.
 */

import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

const TIMEOUT_MS = 10_000;

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export class SmtpFailure extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SmtpFailure';
    this.cause = cause;
  }
}

/** `Atelier Ourlet <desk@atelier-ourlet.example>` to `desk@atelier-ourlet.example`. */
export function addressOf(mailbox: string): string {
  return /<([^>]+)>/.exec(mailbox)?.[1]?.trim() ?? mailbox.trim();
}

/** RFC 2047 for a header that is not plain ASCII. */
function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function body(message: SmtpMessage, domain: string): string {
  const headers = [
    `From: ${headerValue(message.from)}`,
    `To: ${headerValue(message.to)}`,
    `Subject: ${headerValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(message.text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}

class Session {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.fail(new SmtpFailure('The mail socket failed', error)));
    socket.on('close', () => this.fail(new SmtpFailure('The mail socket closed')));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.waiting?.('');
  }

  /** The last line of a reply has a space after its code; earlier lines have a dash. */
  private flush(): void {
    if (this.waiting === null) return;
    const match = /^(?:\d{3}-[^\r\n]*\r\n)*(\d{3} [^\r\n]*)\r\n/.exec(this.buffer);
    if (match === null) return;
    const reply = match[1] as string;
    this.buffer = this.buffer.slice(match[0].length);
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  async expect(codes: readonly number[], sent: string): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.flush();
      if (this.failure !== null) this.fail(this.failure);
    });
    if (this.failure !== null) throw this.failure;
    const code = Number(reply.slice(0, 3));
    if (!codes.includes(code)) {
      throw new SmtpFailure(`${sent} answered ${reply}`);
    }
  }

  send(line: string): void {
    this.socket.write(line);
  }

  end(): void {
    this.socket.destroy();
  }
}

export async function sendMail(
  host: string,
  port: number,
  message: SmtpMessage,
): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host, port });
    candidate.setTimeout(TIMEOUT_MS, () =>
      candidate.destroy(new SmtpFailure('The mail server did not answer in time')),
    );
    candidate.once('connect', () => resolve(candidate));
    candidate.once('error', (error) => reject(new SmtpFailure('The mail server is unreachable', error)));
  });

  const session = new Session(socket);
  try {
    await session.expect([220], 'greeting');
    session.send(`EHLO ${host}\r\n`);
    await session.expect([250], 'EHLO');
    session.send(`MAIL FROM:<${addressOf(message.from)}>\r\n`);
    await session.expect([250], 'MAIL FROM');
    session.send(`RCPT TO:<${addressOf(message.to)}>\r\n`);
    await session.expect([250, 251], 'RCPT TO');
    session.send('DATA\r\n');
    await session.expect([354], 'DATA');
    const text = body(message, addressOf(message.from).split('@')[1] ?? 'localhost');
    session.send(`${text.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
    await session.expect([250], 'message');
    session.send('QUIT\r\n');
  } finally {
    session.end();
  }
}
