import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

export interface SmtpAddressed {
  from: string;
  to: string;
  subject: string;
  text: string;
}

const CRLF = '\r\n';
const COMMAND_TIMEOUT_MS = 10000;

function bareAddress(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return (angled?.[1] ?? mailbox).trim();
}

/** RFC 2047 encoded word, so subjects may carry em dashes and accents. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(value: string): string {
  return (value.match(/.{1,76}/g) ?? []).join(CRLF);
}

class SmtpSession {
  private buffer = '';
  private waiting: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => this.waiting?.reject(error));
    socket.on('close', () => this.waiting?.reject(new Error('SMTP connection closed')));
  }

  private drain(): void {
    if (this.waiting === null) {
      return;
    }
    // A reply ends with a line whose fourth character is a space rather than a hyphen.
    const match = /(^|\r\n)\d{3} [^\r\n]*\r\n$/.exec(this.buffer);
    if (match === null) {
      return;
    }
    const reply = this.buffer;
    this.buffer = '';
    const waiting = this.waiting;
    this.waiting = null;
    waiting.resolve(reply);
  }

  async expect(expectedCode: number, command?: string): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP timed out')), COMMAND_TIMEOUT_MS);
      this.waiting = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      if (command !== undefined) {
        this.socket.write(command + CRLF);
      }
      this.drain();
    });
    const lastLine = reply.trimEnd().split(CRLF).at(-1) ?? '';
    if (Number(lastLine.slice(0, 3)) !== expectedCode) {
      throw new Error(`SMTP answered ${reply.trim()}`);
    }
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.end();
  }
}

/** Sends one message over plain SMTP; the configured relay accepts unauthenticated mail. */
export async function sendMail(
  host: string,
  port: number,
  message: SmtpAddressed,
): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host, port });
    candidate.once('connect', () => resolve(candidate));
    candidate.once('error', reject);
    candidate.setTimeout(COMMAND_TIMEOUT_MS, () => {
      candidate.destroy(new Error('SMTP connect timed out'));
    });
  });
  socket.setTimeout(0);

  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    await session.expect(250, 'EHLO teamseat');
    await session.expect(250, `MAIL FROM:<${bareAddress(message.from)}>`);
    await session.expect(250, `RCPT TO:<${bareAddress(message.to)}>`);
    await session.expect(354, 'DATA');

    const headers = [
      `From: ${encodeHeader(message.from)}`,
      `To: ${encodeHeader(message.to)}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@northfold.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ].join(CRLF);
    const body = wrapBase64(Buffer.from(message.text, 'utf8').toString('base64'));
    session.write(`${headers}${CRLF}${CRLF}${body}${CRLF}.${CRLF}`);
    await session.expect(250);
    await session.expect(221, 'QUIT');
  } finally {
    session.end();
  }
}
