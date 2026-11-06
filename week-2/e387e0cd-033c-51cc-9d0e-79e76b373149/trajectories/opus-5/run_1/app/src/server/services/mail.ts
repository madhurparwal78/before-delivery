import { createConnection } from 'node:net';
import { config } from '../config';

/** A plain SMTP submission to Mailpit. Mail never carries personal data. */

export interface Mail {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from : match[1];
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: import('node:net').Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
    });
  }

  private drain(): void {
    while (this.pending !== null) {
      const match = /^(\d{3})(?:[ -])(?:.*)\r\n/.exec(this.buffer);
      if (match === null) return;
      const lines = this.buffer.split('\r\n');
      let consumed = 0;
      let last = '';
      for (const line of lines) {
        if (line === '') break;
        consumed += line.length + 2;
        last = line;
        if (/^\d{3} /.test(line)) break;
      }
      if (!/^\d{3} /.test(last)) return;
      this.buffer = this.buffer.slice(consumed);
      const resolve = this.pending;
      this.pending = null;
      resolve(last);
    }
  }

  async expect(prefix: string): Promise<void> {
    const line = await new Promise<string>((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      this.pending = resolve;
      this.drain();
      setTimeout(() => reject(new Error('The mail server did not answer')), 10000).unref();
    });
    if (!line.startsWith(prefix)) throw new Error(`The mail server answered ${line}`);
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeRaw(body: string): void {
    this.socket.write(body);
  }

  end(): void {
    this.socket.end();
  }
}

export async function sendMail(mail: Mail): Promise<void> {
  const settings = config().mail;
  const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
    const attempt = createConnection({ host: settings.host, port: settings.port }, () => resolve(attempt));
    attempt.on('error', reject);
    attempt.setTimeout(10000, () => reject(new Error('The mail server did not accept the connection')));
  });
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.write('EHLO lanternline.example');
    await session.expect('250');
    session.write(`MAIL FROM:<${envelopeAddress(settings.from)}>`);
    await session.expect('250');
    for (const recipient of mail.to) {
      session.write(`RCPT TO:<${recipient}>`);
      await session.expect('250');
    }
    session.write('DATA');
    await session.expect('354');
    const headers = [
      `From: ${settings.from}`,
      `To: ${mail.to.join(', ')}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    const body = mail.text
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    session.writeRaw(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await session.expect('250');
    session.write('QUIT');
  } finally {
    session.end();
  }
}
