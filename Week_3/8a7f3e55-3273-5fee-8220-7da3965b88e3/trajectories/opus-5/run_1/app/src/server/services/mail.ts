import { createConnection, type Socket } from 'node:net';
import { env } from '../env.js';

const CONNECT_TIMEOUT_MS = 5_000;
const REPLY_TIMEOUT_MS = 10_000;

function addressOf(mailFrom: string): string {
  const angled = /<([^>]+)>/.exec(mailFrom);
  return angled?.[1] ?? mailFrom.trim();
}

function displayNameOf(mailFrom: string): string {
  return mailFrom.replace(/<[^>]*>/, '').trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Body(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? ['']).join('\r\n');
}

/** Reads SMTP replies line by line: a reply ends on the line whose code is not followed by `-`. */
class SmtpSession {
  private buffer = '';
  private readonly waiting: ((code: number) => void)[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      if (!/^\d{3}(?: |$)/.test(line)) continue;
      this.waiting.shift()?.(Number(line.slice(0, 3)));
    }
  }

  expect(expected: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The mail server did not reply')),
        REPLY_TIMEOUT_MS,
      );
      this.waiting.push((code) => {
        clearTimeout(timer);
        if (Math.floor(code / 100) === Math.floor(expected / 100)) resolve();
        else reject(new Error(`The mail server answered ${code}`));
      });
    });
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeRaw(text: string): void {
    this.socket.write(text);
  }
}

function connect(): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection({ host: env.smtpHost, port: env.smtpPort });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy(new Error('The mail server did not accept a connection'));
    });
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

/** Hands one message to the SMTP sink; a failure leaves the message queued for a later try. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    session.write('EHLO relayline');
    await session.expect(250);
    session.write(`MAIL FROM:<${addressOf(env.mailFrom)}>`);
    await session.expect(250);
    session.write(`RCPT TO:<${to}>`);
    await session.expect(250);
    session.write('DATA');
    await session.expect(354);
    const headers = [
      `From: ${encodeHeader(displayNameOf(env.mailFrom))} <${addressOf(env.mailFrom)}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    session.writeRaw(`${headers}\r\n\r\n${base64Body(text)}\r\n.\r\n`);
    await session.expect(250);
    session.write('QUIT');
  } finally {
    socket.destroy();
  }
}
