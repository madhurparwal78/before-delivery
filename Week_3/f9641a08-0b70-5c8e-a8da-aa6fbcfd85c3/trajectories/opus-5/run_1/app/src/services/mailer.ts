import { createConnection, Socket } from 'node:net';
import { config } from '../config';

export type Mail = { to: string; subject: string; body: string };

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from.trim() : match[1].trim();
}

class SmtpSession {
  private buffer = '';
  private readonly waiting: Array<{ resolve: (code: number) => void; reject: (error: Error) => void }> = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\r\n');
      while (index !== -1) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        if (/^\d{3} /.test(line)) {
          const pending = this.waiting.shift();
          if (pending !== undefined) pending.resolve(Number(line.slice(0, 3)));
        }
        index = this.buffer.indexOf('\r\n');
      }
    });
    socket.on('error', (error: Error) => {
      while (this.waiting.length > 0) this.waiting.shift()!.reject(error);
    });
    socket.on('close', () => {
      while (this.waiting.length > 0) this.waiting.shift()!.reject(new Error('SMTP connection closed'));
    });
  }

  reply(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  async command(line: string, expected: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const code = await this.reply();
    if (Math.floor(code / 100) !== Math.floor(expected / 100)) {
      throw new Error(`SMTP command "${line.split(' ')[0]}" answered ${code}`);
    }
  }

  writeRaw(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(8000);
    socket.once('connect', () => resolve(socket));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
    socket.once('error', reject);
  });
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/** Hands the message to the mail server. Resolves only once the server accepts it. */
export async function sendMail(mail: Mail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.reply();
    if (Math.floor(greeting / 100) !== 2) throw new Error(`SMTP greeting ${greeting}`);
    await session.command('EHLO roamhouse.example', 250);
    await session.command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, 250);
    await session.command(`RCPT TO:<${mail.to}>`, 250);
    session.writeRaw('DATA\r\n');
    const dataCode = await session.reply();
    if (dataCode !== 354) throw new Error(`SMTP DATA answered ${dataCode}`);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${encodeSubject(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit'
    ].join('\r\n');
    session.writeRaw(`${headers}\r\n\r\n${dotStuff(mail.body)}\r\n.\r\n`);
    const accepted = await session.reply();
    if (Math.floor(accepted / 100) !== 2) throw new Error(`SMTP message rejected with ${accepted}`);
    session.writeRaw('QUIT\r\n');
  } finally {
    session.end();
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const socket = await connect();
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}
