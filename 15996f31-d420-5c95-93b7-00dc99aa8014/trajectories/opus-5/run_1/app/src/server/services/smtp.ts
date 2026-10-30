import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

const CONNECT_TIMEOUT_MS = 8_000;

interface Reply {
  code: number;
  text: string;
}

/** One SMTP conversation, enough for the submission of a plain-text message. */
class SmtpSession {
  private buffer = '';
  private pending: ((reply: Reply) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.pending;
    this.pending = null;
    if (waiting !== null) waiting({ code: -1, text: error.message });
  }

  private drain(): void {
    if (this.pending === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (!/^\d{3} /.test(line)) continue;
      const consumed = lines.slice(0, index + 1).join('\r\n');
      this.buffer = this.buffer.slice(consumed.length + 2);
      const waiting = this.pending;
      this.pending = null;
      waiting?.({ code: Number(line.slice(0, 3)), text: consumed });
      return;
    }
  }

  async expect(...codes: readonly number[]): Promise<void> {
    if (this.failure !== null) throw this.failure;
    const reply = await new Promise<Reply>((resolve) => {
      this.pending = resolve;
      this.drain();
    });
    if (!codes.includes(reply.code)) {
      throw new Error(`SMTP server answered ${reply.code}: ${reply.text}`);
    }
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  sendData(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

function mailboxOf(address: string): string {
  const angled = /<([^>]+)>/.exec(address);
  return (angled?.[1] ?? address).trim();
}

function isAscii(value: string): boolean {
  return [...value].every((character) => (character.codePointAt(0) ?? 0) < 128);
}

/** RFC 2047 encoded word, so that a header may carry UTF-8 text. */
function encodeHeader(value: string): string {
  if (isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function rfc5322Date(at: Date): string {
  return at.toUTCString().replace('GMT', '+0000');
}

function messageBody(lines: string): string {
  return lines
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export async function sendMail(
  host: string,
  port: number,
  message: OutgoingEmail,
): Promise<void> {
  const socket = await connect(host, port);
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    session.send('EHLO swarmline-bloom-desk');
    await session.expect(250);
    session.send(`MAIL FROM:<${mailboxOf(message.from)}> BODY=8BITMIME`);
    await session.expect(250);
    session.send(`RCPT TO:<${mailboxOf(message.to)}>`);
    await session.expect(250, 251);
    session.send('DATA');
    await session.expect(354);
    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${rfc5322Date(new Date())}`,
      `Message-ID: <${randomUUID()}@swarmline.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    session.sendData(`${headers}\r\n\r\n${messageBody(message.body)}\r\n.\r\n`);
    await session.expect(250);
    session.send('QUIT');
  } finally {
    session.end();
  }
}
