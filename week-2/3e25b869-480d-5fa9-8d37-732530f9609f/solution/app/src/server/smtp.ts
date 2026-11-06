// Plain SMTP to SMTP_HOST:SMTP_PORT, no authentication, no TLS.
import { connect, type Socket } from 'node:net';
import { config } from './config.js';

const TIMEOUT_MS = 8000;

class Conversation {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;
  private readonly lines: string[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP timeout')));
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf('\r\n')) >= 0) {
        this.lines.push(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 2);
      }
      this.flush();
    });
    const stop = (error?: Error) => {
      this.failure = error ?? new Error('SMTP connection closed');
      this.flush();
    };
    socket.on('error', stop);
    socket.on('close', () => stop());
  }

  private flush(): void {
    if (!this.waiting) return;
    const line = this.lines.shift();
    if (line !== undefined) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(line);
    } else if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('');
    }
  }

  private nextLine(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
  }

  /** Reads one (possibly multi-line) reply and checks its code. */
  async expect(code: number): Promise<void> {
    for (;;) {
      const line = await this.nextLine();
      if (!line) throw this.failure ?? new Error('SMTP connection closed');
      if (line[3] === '-') continue;
      if (Number(line.slice(0, 3)) !== code) throw new Error(`SMTP expected ${code}, got: ${line}`);
      return;
    }
  }

  async command(text: string, code: number): Promise<void> {
    this.socket.write(`${text}\r\n`);
    await this.expect(code);
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

async function open(): Promise<Conversation> {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  const conversation = new Conversation(socket);
  await conversation.expect(220);
  await conversation.command('EHLO loafline', 250);
  return conversation;
}

/** Opens a connection and says goodbye: the mail server health check. */
export async function probe(): Promise<void> {
  const conversation = await open();
  try {
    await conversation.command('QUIT', 221);
  } finally {
    conversation.close();
  }
}

/** Delivers one message to one recipient. `message` holds headers and body with CRLF line ends. */
export async function deliver(recipient: string, message: string): Promise<void> {
  const conversation = await open();
  try {
    await conversation.command(`MAIL FROM:<${config.mail.fromAddress}>`, 250);
    await conversation.command(`RCPT TO:<${recipient}>`, 250);
    await conversation.command('DATA', 354);
    const stuffed = message.replace(/\r\n\./g, '\r\n..');
    await conversation.command(`${stuffed}\r\n.`, 250);
    await conversation.command('QUIT', 221);
  } finally {
    conversation.close();
  }
}
