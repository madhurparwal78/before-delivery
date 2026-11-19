import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';

const SIGNIN_SUBJECT = 'Your Kerbline sign-in link';
const SMTP_TIMEOUT_MS = 5000;

export class MailUnavailable extends Error {}

function senderAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}

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
    socket.on('error', (error) => {
      this.failure = error;
      this.pending = null;
    });
  }

  private flush(): void {
    for (;;) {
      const breakIndex = this.buffer.indexOf('\r\n');
      if (breakIndex < 0) return;
      const line = this.buffer.slice(0, breakIndex);
      this.buffer = this.buffer.slice(breakIndex + 2);
      // Multi-line replies keep the same code with a dash; wait for the final line.
      if (/^\d{3}-/.test(line)) continue;
      const resolve = this.pending;
      this.pending = null;
      if (resolve) resolve(line);
    }
  }

  async expect(codes: number[]): Promise<void> {
    const line = await new Promise<string>((resolve, reject) => {
      if (this.failure) {
        reject(new MailUnavailable(this.failure.message));
        return;
      }
      this.pending = resolve;
      this.socket.once('error', reject);
      this.flush();
    });
    const code = Number.parseInt(line.slice(0, 3), 10);
    if (!codes.includes(code)) throw new MailUnavailable(`smtp said ${line}`);
  }

  async send(command: string, codes: number[]): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(codes);
  }

  close(): void {
    this.socket.destroy();
  }
}

export async function sendSigninEmail(to: string, link: string): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new MailUnavailable('smtp connect timed out'));
    }, SMTP_TIMEOUT_MS);
    connection.once('connect', () => {
      clearTimeout(timer);
      resolve(connection);
    });
    connection.once('error', (error) => {
      clearTimeout(timer);
      reject(new MailUnavailable(error.message));
    });
  });

  const session = new SmtpSession(socket);
  const deadline = setTimeout(() => socket.destroy(), SMTP_TIMEOUT_MS);
  try {
    await session.expect([220]);
    await session.send('EHLO kerbline', [250]);
    await session.send(`MAIL FROM:<${senderAddress(config.mail.from)}>`, [250]);
    await session.send(`RCPT TO:<${to}>`, [250, 251]);
    await session.send('DATA', [354]);
    const body = [
      `From: ${config.mail.from}`,
      `To: <${to}>`,
      `Subject: ${SIGNIN_SUBJECT}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      'Open this link to sign in to Kerbline and keep your garage:',
      '',
      link,
      '',
      'The link works once.',
      '.',
    ].join('\r\n');
    await session.send(body, [250]);
    await session.send('QUIT', [221]);
  } catch (error) {
    throw error instanceof MailUnavailable ? error : new MailUnavailable((error as Error).message);
  } finally {
    clearTimeout(deadline);
    session.close();
  }
}
