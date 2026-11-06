import { createConnection, type Socket } from 'node:net';
import { env } from '../env.js';

const CONNECT_TIMEOUT_MS = 4_000;

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
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
    while (this.pending) {
      const complete = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
      if (!complete) return;
      this.buffer = this.buffer.slice(complete[0].length);
      const resolve = this.pending;
      this.pending = null;
      resolve(complete[0]);
    }
  }

  async expect(code: string): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(() => reject(new Error('smtp timeout')), CONNECT_TIMEOUT_MS);
      this.pending = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.flush();
      this.socket.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const last = reply.trimEnd().split('\n').at(-1) ?? '';
    if (!last.startsWith(code)) throw new Error(`smtp expected ${code}, got ${last}`);
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeData(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }
}

async function connect(): Promise<SmtpSession> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: env.mail.host, port: env.mail.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new Error('smtp connect timeout'));
    }, CONNECT_TIMEOUT_MS);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return new SmtpSession(socket);
}

export function fromAddress(): string {
  const match = /<([^>]+)>/.exec(env.mail.from);
  return match?.[1] ?? env.mail.from;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  queuedAt: Date;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const session = await connect();
  try {
    await session.expect('220');
    session.write('EHLO hearthshift');
    await session.expect('250');
    session.write(`MAIL FROM:<${fromAddress()}>`);
    await session.expect('250');
    session.write(`RCPT TO:<${mail.to}>`);
    await session.expect('250');
    session.write('DATA');
    await session.expect('354');
    const message = [
      `From: ${env.mail.from}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      `Date: ${mail.queuedAt.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      mail.body,
    ].join('\r\n');
    session.writeData(`${dotStuff(message)}\r\n.\r\n`);
    await session.expect('250');
    session.write('QUIT');
  } finally {
    session.close();
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const session = await connect();
    try {
      await session.expect('220');
      session.write('QUIT');
      return true;
    } finally {
      session.close();
    }
  } catch {
    return false;
  }
}
