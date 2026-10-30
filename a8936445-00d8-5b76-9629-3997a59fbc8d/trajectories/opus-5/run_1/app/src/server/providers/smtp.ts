import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { KITCHEN } from '../domain/constants.js';

export class MailUnavailableError extends Error {
  constructor(cause: string) {
    super(`Email unavailable: ${cause}`);
    this.name = 'MailUnavailableError';
  }
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

const STAGE_TIMEOUT_MS = 10_000;

class SmtpSession {
  private buffer = '';
  private waiter: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('connection closed')));
  }

  private fail(error: Error): void {
    this.failure = error;
    this.drain();
  }

  private drain(): void {
    if (!this.waiter) return;
    const complete = this.completeReply();
    if (complete !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(complete);
      return;
    }
    if (this.failure) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve('');
    }
  }

  private completeReply(): string | null {
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index]!;
      if (/^\d{3} /.test(line)) {
        const reply = lines.slice(0, index + 1).join('\r\n');
        this.buffer = lines.slice(index + 1).join('\r\n');
        return reply;
      }
    }
    return null;
  }

  async expect(expectedPrefix: string, stage: string): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new MailUnavailableError(`${stage} timed out`));
      }, STAGE_TIMEOUT_MS);
      this.waiter = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.drain();
    });
    const code = reply.split('\r\n').pop() ?? '';
    if (!code.startsWith(expectedPrefix)) {
      throw new MailUnavailableError(`${stage} answered ${code || 'nothing'}`);
    }
  }

  write(line: string): void {
    this.socket.write(line);
  }

  end(): void {
    this.socket.destroy();
  }
}

function buildMessage(email: OutgoingEmail): string {
  const lines = [
    `From: ${KITCHEN.mailFrom}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@larderrow.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    email.body,
  ];
  return lines
    .join('\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(KITCHEN.mailFrom);
  return match ? match[1]! : KITCHEN.mailFrom;
}

/** Resolves only once the SMTP server has accepted the message data. */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new MailUnavailableError('connection timed out'));
    }, STAGE_TIMEOUT_MS);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error) => {
      clearTimeout(timer);
      reject(new MailUnavailableError(error.message));
    });
  });

  const session = new SmtpSession(socket);
  try {
    await session.expect('220', 'greeting');
    session.write('EHLO stationkeeper\r\n');
    await session.expect('250', 'EHLO');
    session.write(`MAIL FROM:<${senderAddress()}>\r\n`);
    await session.expect('250', 'MAIL FROM');
    session.write(`RCPT TO:<${email.to}>\r\n`);
    await session.expect('250', 'RCPT TO');
    session.write('DATA\r\n');
    await session.expect('354', 'DATA');
    session.write(`${buildMessage(email)}\r\n.\r\n`);
    await session.expect('250', 'message data');
    session.write('QUIT\r\n');
  } finally {
    session.end();
  }
}
