import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
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
    for (;;) {
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
      if (!match || !this.pending) return;
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const resolve = this.pending;
      this.pending = null;
      resolve(reply);
    }
  }

  private async read(): Promise<string> {
    if (this.failure) throw this.failure;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('smtp timeout')), 10_000);
      this.pending = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.flush();
    });
  }

  async expect(prefix: string): Promise<void> {
    const reply = await this.read();
    const code = reply.slice(reply.length - reply.trimStart().length, 3);
    if (!reply.trimStart().startsWith(prefix) && !code.startsWith(prefix)) {
      throw new Error(`smtp replied ${reply.trim()}`);
    }
  }

  write(line: string): void {
    this.socket.write(line);
  }

  close(): void {
    this.socket.end();
  }
}

/** Delivers one message over plain SMTP to the mail sink. */
export async function sendMessage(from: string, recipient: string, message: string): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.mail.host, port: config.mail.port }, () =>
      resolve(candidate));
    candidate.setTimeout(10_000, () => candidate.destroy(new Error('smtp connect timeout')));
    candidate.once('error', reject);
  });
  const session = new SmtpSession(socket);
  try {
    await session.expect('220');
    session.write('EHLO rungboard\r\n');
    await session.expect('250');
    session.write(`MAIL FROM:<${from}>\r\n`);
    await session.expect('250');
    session.write(`RCPT TO:<${recipient}>\r\n`);
    await session.expect('250');
    session.write('DATA\r\n');
    await session.expect('354');
    const stuffed = message
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    session.write(`${stuffed}\r\n.\r\n`);
    await session.expect('250');
    session.write('QUIT\r\n');
  } finally {
    session.close();
  }
}
