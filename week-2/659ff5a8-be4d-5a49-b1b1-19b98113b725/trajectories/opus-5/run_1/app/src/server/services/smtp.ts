import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

const CONNECT_TIMEOUT_MS = 5_000;
const REPLY_TIMEOUT_MS = 5_000;

export class MailUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailUnavailable';
  }
}

export interface Envelope {
  to: string;
  subject: string;
  body: string;
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match ? (match[1] as string) : mailbox.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(envelope: Envelope): string {
  const lines = [
    `From: ${config.mail.from}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeHeader(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@conecount-paddock>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...envelope.body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
  ];
  return `${lines.join('\r\n')}\r\n.\r\n`;
}

class SmtpSession {
  private buffer = '';
  private pending: ((reply: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.flush();
    });
    socket.on('close', () => {
      this.failure ??= new Error('SMTP connection closed');
      this.flush();
    });
  }

  private flush(): void {
    if (!this.pending) return;
    const match = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (match) {
      const reply = this.buffer.slice(0, match.index + match[0].length);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const resolve = this.pending;
      this.pending = null;
      resolve(reply);
      return;
    }
    if (this.failure) {
      const resolve = this.pending;
      this.pending = null;
      resolve(`000 ${this.failure.message}`);
    }
  }

  async readReply(): Promise<string> {
    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new MailUnavailable('SMTP reply timed out'));
      }, REPLY_TIMEOUT_MS);
      this.pending = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.flush();
    });
    return reply;
  }

  async send(command: string, expected: number): Promise<void> {
    this.socket.write(command.endsWith('\r\n') ? command : `${command}\r\n`);
    const reply = await this.readReply();
    const code = Number.parseInt(reply.trimStart().slice(0, 3), 10);
    if (code !== expected) {
      throw new MailUnavailable(`SMTP command rejected: ${reply.trim()}`);
    }
  }

  close(): void {
    this.socket.destroy();
  }
}

/** Delivers one message and resolves only when the mail server has accepted it. */
export async function sendMail(envelope: Envelope): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new MailUnavailable('SMTP connection timed out'));
    }, CONNECT_TIMEOUT_MS);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(new MailUnavailable(`SMTP connection failed: ${error.message}`));
    });
  });

  const session = new SmtpSession(socket);
  try {
    const greeting = await session.readReply();
    if (!greeting.trimStart().startsWith('220')) {
      throw new MailUnavailable(`SMTP greeting rejected: ${greeting.trim()}`);
    }
    await session.send('EHLO conecount-paddock', 250);
    await session.send(`MAIL FROM:<${addressOf(config.mail.from)}>`, 250);
    await session.send(`RCPT TO:<${addressOf(envelope.to)}>`, 250);
    await session.send('DATA', 354);
    await session.send(buildMessage(envelope), 250);
    await session.send('QUIT', 221);
  } finally {
    session.close();
  }
}
