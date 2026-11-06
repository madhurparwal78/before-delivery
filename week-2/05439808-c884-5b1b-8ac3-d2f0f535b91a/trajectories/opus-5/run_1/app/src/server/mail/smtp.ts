import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

const CONNECT_TIMEOUT_MS = 4000;

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
    });
  }

  private flush(): void {
    while (this.waiting) {
      const complete = /(^|\n)(\d{3}) [^\n]*\r?\n/.exec(this.buffer);
      if (!complete) return;
      const end = complete.index + complete[0].length;
      const reply = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    }
  }

  async expect(prefix: string): Promise<void> {
    if (this.failure) throw this.failure;
    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP reply timeout')), CONNECT_TIMEOUT_MS);
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.flush();
      this.socket.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const code = /(\d{3}) [^\n]*\r?\n$/.exec(reply)?.[1] ?? '';
    if (!code.startsWith(prefix)) throw new Error(`SMTP refused with ${code}`);
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  close(): void {
    this.socket.destroy();
  }
}

async function openSession(): Promise<SmtpSession> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: config.smtpHost, port: config.smtpPort });
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new Error('SMTP connect timeout'));
    }, CONNECT_TIMEOUT_MS);
    connection.once('connect', () => {
      clearTimeout(timer);
      resolve(connection);
    });
    connection.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const session = new SmtpSession(socket);
  await session.expect('2');
  session.send('EHLO saltreach');
  await session.expect('2');
  return session;
}

export async function probeSmtp(): Promise<void> {
  const session = await openSession();
  session.send('QUIT');
  session.close();
}

export type OutgoingMail = { to: string; subject: string; body: string };

export async function deliver(mail: OutgoingMail, at: Date): Promise<void> {
  const session = await openSession();
  try {
    session.send(`MAIL FROM:<${addressOf(config.mailFrom)}>`);
    await session.expect('2');
    session.send(`RCPT TO:<${mail.to}>`);
    await session.expect('2');
    session.send('DATA');
    await session.expect('3');
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      `Date: ${at.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8'
    ];
    const lines = mail.body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line));
    session.send([...headers, '', ...lines, '.'].join('\r\n'));
    await session.expect('2');
    session.send('QUIT');
  } finally {
    session.close();
  }
}
