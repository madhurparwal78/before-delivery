import { createConnection, type Socket } from 'node:net';

const TIMEOUT_MS = 6000;

export interface Envelope {
  host: string;
  port: number;
  from: string;
  to: string;
  message: Buffer;
}

class Session {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS);
    socket.on('data', (chunk: string) => this.take(chunk));
    socket.on('error', (error: Error) => this.failure?.(error));
    socket.on('timeout', () => this.failure?.(new Error('smtp timeout')));
    socket.on('close', () => this.failure?.(new Error('smtp connection closed')));
  }

  private take(chunk: string): void {
    this.buffer += chunk;
    const match = /^\d{3} [^\n]*\r?\n/m.exec(this.buffer);
    if (match === null) return;
    this.buffer = this.buffer.slice(this.buffer.indexOf(match[0]) + match[0].length);
    const resolve = this.waiting;
    this.waiting = null;
    resolve?.(match[0]);
  }

  reply(expected: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = (line: string) => {
        if (line.startsWith(expected)) resolve();
        else reject(new Error(`smtp answered ${line.trim()}`));
      };
      this.failure = reject;
    });
  }

  async command(text: string, expected: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    await this.reply(expected);
  }

  write(payload: Buffer | string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.destroy();
  }
}

/** Hands one message to the mail server and resolves only once it has accepted it. */
export async function deliver(envelope: Envelope): Promise<void> {
  const socket = createConnection({ host: envelope.host, port: envelope.port });
  const session = new Session(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', (error: Error) => reject(error));
      socket.once('timeout', () => reject(new Error('smtp connect timeout')));
    });
    await session.reply('220');
    await session.command('EHLO switchyard', '250');
    await session.command(`MAIL FROM:<${envelope.from}>`, '250');
    await session.command(`RCPT TO:<${envelope.to}>`, '250');
    await session.command('DATA', '354');
    session.write(envelope.message);
    session.write('\r\n.\r\n');
    await session.reply('250');
    socket.write('QUIT\r\n');
  } finally {
    session.end();
  }
}
