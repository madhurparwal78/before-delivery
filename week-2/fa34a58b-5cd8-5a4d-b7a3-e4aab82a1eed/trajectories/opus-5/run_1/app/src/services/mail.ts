import { createConnection, type Socket } from 'node:net';
import { config } from '../config';
import { hubNow } from './hubClock';

const CONNECT_TIMEOUT_MS = 4000;
const REPLY_TIMEOUT_MS = 6000;

/** A minimal SMTP client: Mailpit takes plain submission with no auth and no TLS. */
class SmtpSession {
  private buffer = '';
  private pending: ((reply: string) => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  static connect(): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('SMTP connect timed out'));
      });
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.setTimeout(0);
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('error');
        resolve(new SmtpSession(socket));
      });
    });
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.pending;
    this.pending = null;
    waiting?.('');
  }

  /** A reply ends with a line whose fourth character is a space, as in "250 Ok". */
  private drain(): void {
    if (!this.pending) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] as string;
      if (line.length >= 4 && line[3] !== '-') {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        const waiting = this.pending;
        this.pending = null;
        waiting(reply);
        return;
      }
    }
  }

  private readReply(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('SMTP reply timed out'));
      }, REPLY_TIMEOUT_MS);
      this.pending = (reply: string) => {
        clearTimeout(timer);
        if (this.failure) reject(this.failure);
        else resolve(reply);
      };
      this.drain();
    });
  }

  async command(text: string, expected: number): Promise<string> {
    this.socket.write(`${text}\r\n`);
    return await this.expect(expected, text.split(' ')[0] ?? text);
  }

  async expect(expected: number, what: string): Promise<string> {
    const reply = await this.readReply();
    if (!reply.startsWith(String(expected))) {
      throw new Error(`SMTP refused ${what}: ${reply}`);
    }
    return reply;
  }

  writeData(payload: string): void {
    this.socket.write(payload);
  }

  close(): void {
    this.socket.destroy();
  }
}

function addressOf(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return angled ? (angled[1] as string) : mailbox.trim();
}

/** Dot-stuffing, so a line of a single dot inside the body cannot end the message. */
function dotStuff(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function isMailUp(): Promise<boolean> {
  let session: SmtpSession | null = null;
  try {
    session = await SmtpSession.connect();
    await session.expect(220, 'greeting');
    await session.command('EHLO nightplan', 250);
    await session.command('QUIT', 221);
    return true;
  } catch {
    return false;
  } finally {
    session?.close();
  }
}

/** Sends one plain-text household notice. Resolves only once SMTP accepts it. */
export async function sendNoticeMail(message: {
  noticeId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const session = await SmtpSession.connect();
  try {
    await session.expect(220, 'greeting');
    const extensions = await session.command('EHLO nightplan', 250);
    const eightBit = extensions.includes('8BITMIME');
    const from = addressOf(config.mailFrom);
    await session.command(`MAIL FROM:<${from}>${eightBit ? ' BODY=8BITMIME' : ''}`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250);
    await session.command('DATA', 354);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${hubNow().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      `X-Nightplan-Notice: ${message.noticeId}`,
    ].join('\r\n');
    session.writeData(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    await session.expect(250, 'message');
    await session.command('QUIT', 221);
  } finally {
    session.close();
  }
}
