import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

const CONNECT_TIMEOUT_MS = 5000;

export interface Envelope {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** `Name <box@example>` → `box@example` */
function addressOf(mailbox: string): string {
  return /<([^>]+)>/.exec(mailbox)?.[1] ?? mailbox.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function messageOf(envelope: Envelope): string {
  const headers = [
    `From: ${encodeHeader(envelope.from)}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeHeader(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@teamseat>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = envelope.text
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n.`;
}

class SmtpSession {
  private buffer = '';
  private collected: string[] = [];
  private readonly replies: string[] = [];
  private wake: (() => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.ingest(chunk));
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      this.collected.push(line);
      if (/^\d{3} /.test(line)) {
        this.replies.push(this.collected.join('\n'));
        this.collected = [];
      }
    }
    this.wake?.();
  }

  private fail(error: Error): void {
    this.failure = error;
    this.wake?.();
  }

  private async nextReply(): Promise<string> {
    while (this.replies.length === 0) {
      if (this.failure !== null) throw this.failure;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
    return this.replies.shift() as string;
  }

  async expect(...codes: number[]): Promise<void> {
    const reply = await this.nextReply();
    const code = Number.parseInt(reply.slice(0, 3), 10);
    if (!codes.includes(code)) throw new Error(`SMTP answered ${reply}`);
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  end(): void {
    this.socket.destroy();
  }
}

function openSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('SMTP timed out'));
    });
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

/** Delivers one message over plain SMTP, as Mailpit accepts it. */
export async function sendMail(
  host: string,
  port: number,
  envelope: Envelope,
): Promise<void> {
  const socket = await openSocket(host, port);
  const session = new SmtpSession(socket);
  try {
    await session.expect(220);
    session.send('EHLO teamseat');
    await session.expect(250);
    session.send(`MAIL FROM:<${addressOf(envelope.from)}>`);
    await session.expect(250);
    session.send(`RCPT TO:<${addressOf(envelope.to)}>`);
    await session.expect(250, 251);
    session.send('DATA');
    await session.expect(354);
    session.send(messageOf(envelope));
    await session.expect(250);
    session.send('QUIT');
  } finally {
    session.end();
  }
}
