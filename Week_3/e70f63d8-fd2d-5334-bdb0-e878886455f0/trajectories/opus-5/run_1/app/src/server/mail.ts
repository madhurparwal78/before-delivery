import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { now } from './clock.js';

class SmtpSession {
  private buffer = '';
  private waiting: { codes: number[]; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.check();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(error: Error): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }

  private check(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length >= 4 && line[3] === '-') continue;
      if (line.length >= 3 && /^\d{3}/.test(line)) {
        this.buffer = lines.slice(index + 1).join('\r\n');
        this.waiting = null;
        const code = Number(line.slice(0, 3));
        if (waiting.codes.includes(code)) waiting.resolve();
        else waiting.reject(new Error(`smtp replied ${line}`));
        return;
      }
    }
  }

  expect(codes: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = { codes, resolve, reject };
      this.check();
    });
  }

  async send(command: string, codes: number[]): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(codes);
  }

  end(): void {
    this.socket.destroy();
  }
}

/** An unreachable Mailpit may be configured with an http scheme; SMTP needs a bare host. */
function smtpHost(): string {
  const value = config.smtp.host.replace(/^https?:\/\//, '');
  return value.split('/')[0].split(':')[0];
}

function connectSmtp(timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: smtpHost(), port: config.smtp.port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('smtp connect timed out'));
    });
    socket.once('error', (error) => reject(error));
  });
}

function envelopeAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

export async function mailReachable(): Promise<boolean> {
  try {
    const socket = await connectSmtp(1000);
    const session = new SmtpSession(socket);
    await session.expect([220]);
    session.end();
    return true;
  } catch {
    return false;
  }
}

export async function sendInvitation(args: {
  to: string;
  home: string;
  away: string;
  token: string;
}): Promise<void> {
  const socket = await connectSmtp(3000);
  const session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    await session.send('EHLO overcall', [250]);
    await session.send(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, [250]);
    await session.send(`RCPT TO:<${args.to}>`, [250, 251]);
    await session.send('DATA', [354]);
    const link = `${config.appBaseUrl}/invitations/${args.token}`;
    const body = [
      `From: ${config.mailFrom}`,
      `To: ${args.to}`,
      `Subject: Score ${args.home} v ${args.away} on Overcall`,
      `Date: ${now().toUTCString()}`,
      `Message-ID: <${randomUUID()}@overcall.test>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      `You have been invited to score ${args.home} v ${args.away} on Overcall.`,
      '',
      link,
      '',
      `This invitation works once and expires after ${config.inviteTtlHours} hours.`,
      '',
      '.',
    ].join('\r\n');
    socket.write(`${body}\r\n`);
    await session.expect([250]);
    await session.send('QUIT', [221]);
  } finally {
    session.end();
  }
}
