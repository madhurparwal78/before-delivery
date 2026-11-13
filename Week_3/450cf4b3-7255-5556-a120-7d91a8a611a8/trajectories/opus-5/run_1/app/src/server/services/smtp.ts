import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

export interface OutgoingMail {
  fromAddress: string;
  fromHeader: string;
  toName: string;
  toEmail: string;
  subject: string;
  body: string;
  messageId: string;
  date: Date;
}

class SmtpSession {
  private buffer = '';
  private pending: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(error: Error): void {
    this.failure = error;
    const pending = this.pending;
    this.pending = null;
    if (pending !== null) pending.reject(error);
  }

  private drain(): void {
    if (this.pending === null) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] ?? '';
      if (/^\d{3} /.test(line)) {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        const pending = this.pending;
        this.pending = null;
        pending.resolve(reply);
        return;
      }
    }
  }

  read(): Promise<string> {
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.drain();
    });
  }

  async command(line: string, expected: number): Promise<string> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    const code = Number(reply.slice(0, 3));
    if (Math.floor(code / 100) !== Math.floor(expected / 100)) {
      throw new Error(`smtp command refused with ${code}`);
    }
    return reply;
  }

  writeRaw(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.destroy();
  }
}

function encodeDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = /^[\x20-\x7E]*$/.test(name);
  if (ascii) {
    return `"${name.replace(/([\\"])/g, '\\$1')}"`;
  }
  return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
}

function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function rfc2822Date(at: Date): string {
  return at.toUTCString().replace('GMT', '+0000');
}

function message(mail: OutgoingMail): string {
  const headers = [
    `From: ${mail.fromHeader}`,
    `To: ${encodeDisplayName(mail.toName)} <${mail.toEmail}>`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Message-ID: ${mail.messageId}`,
    `Date: ${rfc2822Date(mail.date)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = mail.body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

/** Delivers one message, resolving only on the success reply to the end of DATA. */
export async function deliver(mail: OutgoingMail): Promise<void> {
  const socket: Socket = createConnection({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(15_000, () => socket.destroy(new Error('smtp timeout')));
  const session = new SmtpSession(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', (error: Error) => reject(error));
    });
    await session.read();
    await session.command('EHLO stationhouse.test', 250);
    await session.command(`MAIL FROM:<${mail.fromAddress}>`, 250);
    await session.command(`RCPT TO:<${mail.toEmail}>`, 250);
    await session.command('DATA', 354);
    session.writeRaw(message(mail));
    await session.command('.', 250);
    await session.command('QUIT', 221).catch(() => '');
  } finally {
    session.end();
  }
}
