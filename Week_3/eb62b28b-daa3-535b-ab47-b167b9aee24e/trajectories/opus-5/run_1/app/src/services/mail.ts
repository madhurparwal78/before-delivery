import { connect, Socket } from 'node:net';
import { config } from '../config';

export interface Envelope {
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? (match[1] as string) : from;
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    const complete = /(^|\n)(\d{3}) [^\n]*\n$/.exec(this.buffer);
    if (complete && this.waiting) {
      const reply = this.buffer;
      this.buffer = '';
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    }
  }

  read(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
  }

  async command(text: string, expect: string[]): Promise<void> {
    this.socket.write(`${text}\r\n`);
    const reply = await this.read();
    const lines = reply.trim().split(/\r?\n/);
    const status = (lines[lines.length - 1] ?? '').slice(0, 3);
    if (!expect.includes(status)) {
      throw new Error(`SMTP refused ${text.split(' ')[0]}: ${reply.trim()}`);
    }
  }
}

/** Hands one mail to the SMTP server; it throws when the server will not take it. */
export async function deliver(envelope: Envelope): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const pending: Socket = connect({ host: config.mail.host, port: config.mail.port }, () =>
      resolve(pending),
    );
    pending.setTimeout(10000, () => {
      pending.destroy(new Error('SMTP timed out'));
    });
    pending.on('error', reject);
  });
  const session = new SmtpSession(socket);
  try {
    await session.read();
    await session.command('EHLO ocotillo', ['250']);
    await session.command(`MAIL FROM:<${envelopeAddress(config.mail.from)}>`, ['250']);
    await session.command(`RCPT TO:<${envelope.to}>`, ['250', '251']);
    await session.command('DATA', ['354', '250']);
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${envelope.to}`,
      `Subject: ${envelope.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    const body = envelope.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    const reply = await session.read();
    if (!/\b250\b/.test(reply)) throw new Error(`SMTP refused the message: ${reply.trim()}`);
    await session.command('QUIT', ['221', '250']);
  } finally {
    socket.destroy();
  }
}
