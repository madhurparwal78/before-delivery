import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

export interface SmtpAddress {
  readonly display: string;
  readonly address: string;
}

export interface SmtpMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
}

/** Reads the address out of a `Name <box@example.test>` line. */
export function mailbox(line: string): string {
  const angled = /<([^>]+)>/.exec(line);
  return (angled?.[1] ?? line).trim();
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = '';
  private waiting: ((reply: string) => void) | null = null;
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
      this.waiting?.('');
      this.waiting = null;
    });
  }

  /** SMTP replies end with a line whose code is followed by a space. */
  private completeReply(): string | null {
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (/^\d{3} /.test(line)) {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        return reply;
      }
    }
    return null;
  }

  private flush(): void {
    if (!this.waiting) return;
    const reply = this.completeReply();
    if (reply === null) return;
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  async expect(codes: readonly number[]): Promise<string> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
    if (this.failure) throw this.failure;
    const lastLine = reply.split('\r\n').filter((line) => line !== '').at(-1) ?? '';
    const code = Number.parseInt(lastLine.slice(0, 3), 10);
    if (!codes.includes(code)) throw new Error(`smtp replied ${reply.trim()}`);
    return reply;
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  end(): void {
    this.socket.end();
  }
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/**
 * The one mail transport: plain SMTP to the configured server, which Mailpit captures.
 * Every failure is reported to the caller, which keeps the letter for the retry loop.
 */
export async function sendOverSmtp(options: SmtpOptions, message: SmtpMessage): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: options.host, port: options.port });
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new Error('smtp connection timed out'));
    }, options.timeoutMs);
    timer.unref();
    connection.once('connect', () => {
      clearTimeout(timer);
      resolve(connection);
    });
    connection.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  socket.setTimeout(options.timeoutMs, () => socket.destroy(new Error('smtp timed out')));
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    session.send('EHLO strikeproof');
    await session.expect([250]);
    session.send(`MAIL FROM:<${mailbox(message.from)}>`);
    await session.expect([250]);
    session.send(`RCPT TO:<${mailbox(message.to)}>`);
    await session.expect([250, 251]);
    session.send('DATA');
    await session.expect([354]);
    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@strikeproof.test>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    socket.write(`${headers}\r\n\r\n${dotStuff(message.text)}\r\n.\r\n`);
    await session.expect([250]);
    session.send('QUIT');
  } finally {
    session.end();
  }
}
