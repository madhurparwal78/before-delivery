import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { env } from './env';

const fromAddress = (): string => {
  const match = /<([^>]+)>/.exec(env.smtp.from);
  return match === null ? env.smtp.from.trim() : match[1];
};

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

class SmtpSession {
  private buffer = '';
  private waiting: { codes: number[]; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.consume();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('smtp connection closed')));
  }

  private fail(error: Error): void {
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting !== null) waiting.reject(error);
  }

  private consume(): void {
    const waiting = this.waiting;
    if (waiting === null) return;
    const lines = this.buffer.split('\r\n');
    for (const [index, line] of lines.entries()) {
      if (line.length < 4) continue;
      if (line[3] === '-') continue;
      const code = Number(line.slice(0, 3));
      this.buffer = lines.slice(index + 1).join('\r\n');
      this.waiting = null;
      if (waiting.codes.includes(code)) waiting.resolve();
      else waiting.reject(new Error(`smtp replied ${code}`));
      return;
    }
  }

  expect(codes: number[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.waiting = { codes, resolve, reject };
      this.consume();
    });
  }

  async command(line: string, codes: number[]): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(codes);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.end();
  }
}

const openSession = (): Promise<SmtpSession> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: env.smtp.host, port: env.smtp.port });
    socket.setTimeout(10000, () => socket.destroy(new Error('smtp timed out')));
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      resolve(new SmtpSession(socket));
    });
  });

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

export const sendMail = async (mail: Mail): Promise<void> => {
  const session = await openSession();
  const sender = fromAddress();
  try {
    await session.expect([220]);
    await session.command('EHLO pinsheet', [250]);
    await session.command(`MAIL FROM:<${sender}>`, [250]);
    await session.command(`RCPT TO:<${mail.to}>`, [250, 251]);
    await session.command('DATA', [354]);
    const headers = [
      `From: ${env.smtp.from}`,
      `To: ${mail.to}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@pinsheet>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const body = mail.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    session.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await session.expect([250]);
    await session.command('QUIT', [221]);
  } finally {
    session.end();
  }
};

export const checkMail = async (): Promise<boolean> => {
  try {
    const session = await openSession();
    try {
      await session.expect([220]);
      await session.command('EHLO pinsheet', [250]);
      await session.command('QUIT', [221]);
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
};

export const signupMail = (email: string, code: string): Mail => ({
  to: email,
  subject: 'Your Pinsheet code',
  body: `Your Pinsheet code is ${code}.`,
});

export const inviteMail = (email: string, inviterName: string, boardTitle: string, role: string, token: string): Mail => ({
  to: email,
  subject: `${inviterName} invited you to ${boardTitle} on Pinsheet`,
  body: `${inviterName} invited you to ${boardTitle} as a ${role.toLowerCase()}. Open ${env.publicUrl}/invite/${token} to join.`,
});
