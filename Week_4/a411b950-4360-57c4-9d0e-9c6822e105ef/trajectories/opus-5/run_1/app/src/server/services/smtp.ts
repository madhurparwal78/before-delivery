import { createConnection, type Socket } from 'node:net';
import { config } from '../config.ts';

const TIMEOUT_MS = 5_000;

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.drain();
    });
    socket.on('close', () => {
      this.failure ??= new Error('The SMTP connection closed');
      this.drain();
    });
  }

  private drain(): void {
    if (this.waiting === null) return;
    const complete = /^\d{3} [^\r\n]*\r\n/m;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (/^\d{3} /.test(line)) {
        const resolve = this.waiting;
        this.waiting = null;
        this.buffer = lines.slice(index + 1).join('\r\n');
        resolve(line);
        return;
      }
    }
    if (this.failure !== null && !complete.test(this.buffer)) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('000 connection lost');
    }
  }

  async read(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
  }

  write(data: string | Buffer): void {
    this.socket.write(data);
  }

  async command(line: string, expected: number): Promise<void> {
    this.write(`${line}\r\n`);
    const reply = await this.read();
    if (!reply.startsWith(String(expected))) throw new Error(`SMTP refused ${line.split(' ')[0] ?? ''}: ${reply}`);
  }

  close(): void {
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), 500);
    timer.unref();
  }
}

function dotStuff(message: Buffer): Buffer {
  const text = message.toString('binary').replace(/\r\n\./g, '\r\n..');
  const prefixed = text.startsWith('.') ? `.${text}` : text;
  return Buffer.from(prefixed, 'binary');
}

function envelopeAddress(mailFrom: string): string {
  const angled = /<([^>]+)>/.exec(mailFrom);
  return angled?.[1] ?? mailFrom.trim();
}

/** Sends the stored message bytes unchanged. Resolves only once the server has accepted them. */
export async function deliverMessage(toAddress: string, message: Buffer): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const pending = createConnection({ host: config.mail.host, port: config.mail.port });
    pending.setTimeout(TIMEOUT_MS, () => {
      pending.destroy();
      reject(new Error('The SMTP server did not answer in time'));
    });
    pending.once('connect', () => {
      pending.setTimeout(0);
      resolve(pending);
    });
    pending.once('error', (error) => reject(error));
  });

  const session = new SmtpSession(socket);
  try {
    const greeting = await session.read();
    if (!greeting.startsWith('220')) throw new Error(`SMTP greeting refused: ${greeting}`);
    await session.command('EHLO earshot', 250);
    await session.command(`MAIL FROM:<${envelopeAddress(config.mail.from)}>`, 250);
    await session.command(`RCPT TO:<${toAddress}>`, 250);
    await session.command('DATA', 354);
    session.write(dotStuff(message));
    session.write('\r\n.\r\n');
    const accepted = await session.read();
    if (!accepted.startsWith('250')) throw new Error(`SMTP rejected the message: ${accepted}`);
    session.write('QUIT\r\n');
  } finally {
    session.close();
  }
}
