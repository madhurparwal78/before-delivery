import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

export interface Envelope {
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
}

class SmtpSession {
  private readonly lines: AsyncIterableIterator<string>;

  constructor(private readonly socket: Socket) {
    this.lines = createInterface({ input: socket, crlfDelay: Infinity })[Symbol.asyncIterator]();
  }

  async expect(code: string): Promise<void> {
    for (;;) {
      const next = await this.lines.next();
      if (next.done) throw new Error('SMTP connection closed early');
      const line = next.value;
      if (line.startsWith(`${code}-`)) continue;
      if (line.startsWith(code)) return;
      throw new Error(`SMTP expected ${code}, received ${line}`);
    }
  }

  send(command: string): void {
    this.socket.write(`${command}\r\n`);
  }
}

function headerAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return match ? match[1]! : value.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Body(body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? ['']).join('\r\n');
}

/** A minimal SMTP client for the local mail service. */
export async function sendMail(host: string, port: number, envelope: Envelope): Promise<void> {
  const socket = createConnection({ host, port });
  socket.setTimeout(10_000);
  try {
    await once(socket, 'connect');
    const session = new SmtpSession(socket);
    await session.expect('220');
    session.send('EHLO rulehouse');
    await session.expect('250');
    session.send(`MAIL FROM:<${headerAddress(envelope.from)}>`);
    await session.expect('250');
    session.send(`RCPT TO:<${headerAddress(envelope.to)}>`);
    await session.expect('250');
    session.send('DATA');
    await session.expect('354');

    const headers = [
      `From: ${envelope.from}`,
      `To: ${envelope.to}`,
      `Subject: ${encodeHeader(envelope.subject)}`,
      `Date: ${envelope.date.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ];
    socket.write(`${headers.join('\r\n')}\r\n\r\n${base64Body(envelope.body)}\r\n.\r\n`);
    await session.expect('250');
    session.send('QUIT');
  } finally {
    socket.destroy();
  }
}
