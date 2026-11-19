import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';

interface Message {
  to: string;
  subject: string;
  body: string;
}

const fromAddress = (): string => {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return match ? match[1] : config.smtp.from;
};

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failed: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => {
      this.failed = error;
      this.waiting?.('');
    });
  }

  private drain(): void {
    if (!this.waiting) return;
    const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
    if (!match) return;
    const reply = match[0];
    this.buffer = this.buffer.slice(reply.length);
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  async expect(prefix: string): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
    if (this.failed) throw this.failed;
    const code = reply.trimEnd().split('\n').at(-1) ?? '';
    if (!code.startsWith(prefix)) throw new Error(`SMTP refused: ${reply.trim()}`);
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }
}

/** Sends one message to Mailpit. Resolves true when Mailpit accepted it. */
export const sendMail = async (message: Message): Promise<boolean> => {
  const socket = await new Promise<Socket | null>((resolve) => {
    const attempt = createConnection({ host: config.smtp.host, port: config.smtp.port, timeout: 3000 });
    const fail = (): void => {
      attempt.destroy();
      resolve(null);
    };
    attempt.once('connect', () => {
      attempt.setTimeout(0);
      resolve(attempt);
    });
    attempt.once('error', fail);
    attempt.once('timeout', fail);
  });
  if (!socket) return false;

  const session = new SmtpSession(socket);
  const from = fromAddress();
  try {
    await session.expect('220');
    session.send('EHLO quarkyard');
    await session.expect('250');
    session.send(`MAIL FROM:<${from}>`);
    await session.expect('250');
    session.send(`RCPT TO:<${message.to}>`);
    await session.expect('25');
    session.send('DATA');
    await session.expect('354');
    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    const dotStuffed = message.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    session.send(`${headers}\r\n\r\n${dotStuffed}\r\n.`);
    await session.expect('250');
    session.send('QUIT');
    socket.end();
    return true;
  } catch {
    socket.destroy();
    return false;
  }
};

export const verificationMessage = (email: string, token: string, expiresAt: Date): Message => ({
  to: email,
  subject: 'Verify your Quarkyard email',
  body: [
    'Welcome to Quarkyard.',
    '',
    'Open this link to verify your email address:',
    `${config.publicUrl}/verify?token=${token}`,
    '',
    `This link expires at ${expiresAt.toISOString()}.`,
    '',
    'Hollowbrook Maker Co.',
  ].join('\n'),
});
