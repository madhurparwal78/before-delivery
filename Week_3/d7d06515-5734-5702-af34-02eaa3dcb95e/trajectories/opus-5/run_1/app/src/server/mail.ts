import net from 'node:net';
import crypto from 'node:crypto';
import { config } from './config';

export class MailUnavailable extends Error {}

interface SmtpReply {
  code: number;
  text: string;
}

const FROM_ADDRESS = (() => {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return match !== null ? match[1]! : config.smtp.from.trim();
})();

class SmtpSession {
  private buffer = '';
  private readonly replies: SmtpReply[] = [];
  private waiting: { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void } | null = null;
  private broken: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.parse();
    });
    socket.on('error', (error) => this.abort(new MailUnavailable(`smtp socket error: ${error.message}`)));
    socket.on('close', () => this.abort(new MailUnavailable('smtp connection closed')));
  }

  private replyEnd(): number {
    let start = 0;
    while (true) {
      const newline = this.buffer.indexOf('\r\n', start);
      if (newline < 0) return -1;
      const line = this.buffer.slice(start, newline);
      if (/^\d{3}(?: |$)/.test(line)) return newline;
      start = newline + 2;
    }
  }

  private parse(): void {
    while (true) {
      const end = this.replyEnd();
      if (end < 0) return;
      const text = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const lastLine = text.split('\r\n').at(-1)!;
      this.replies.push({ code: Number(lastLine.slice(0, 3)), text });
      this.handOver();
    }
  }

  private handOver(): void {
    if (this.waiting === null) return;
    const reply = this.replies.shift();
    if (reply === undefined) return;
    const { resolve } = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  private abort(error: Error): void {
    this.broken = error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }

  expect(): Promise<SmtpReply> {
    return new Promise<SmtpReply>((resolve, reject) => {
      const ready = this.replies.shift();
      if (ready !== undefined) {
        resolve(ready);
        return;
      }
      if (this.broken !== null) {
        reject(this.broken);
        return;
      }
      this.waiting = { resolve, reject };
    });
  }

  send(raw: string): void {
    this.socket.write(raw);
  }

  async command(line: string, accepted: readonly number[]): Promise<void> {
    this.send(`${line}\r\n`);
    const reply = await this.expect();
    if (!accepted.includes(reply.code)) throw new MailUnavailable(`smtp refused: ${reply.text}`);
  }

  close(): void {
    this.socket.destroy();
  }
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(to: string, subject: string, body: string): string {
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@corbelworks.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const dotStuffed = body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${dotStuffed}\r\n`;
}

async function connect(): Promise<net.Socket> {
  return await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000);
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new MailUnavailable('smtp connect timed out'));
    });
    socket.once('error', (error) => reject(new MailUnavailable(`smtp connect failed: ${error.message}`)));
  });
}

/** Sends one message and resolves only once the SMTP server has accepted it. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const session = new SmtpSession(await connect());
  try {
    const greeting = await session.expect();
    if (greeting.code !== 220) throw new MailUnavailable(`smtp greeting ${greeting.code}`);
    await session.command('EHLO corbel-draft', [250]);
    await session.command(`MAIL FROM:<${FROM_ADDRESS}>`, [250]);
    await session.command(`RCPT TO:<${to}>`, [250, 251]);
    await session.command('DATA', [354]);
    session.send(`${buildMessage(to, subject, body)}.\r\n`);
    const accepted = await session.expect();
    if (accepted.code !== 250) throw new MailUnavailable(`smtp did not accept the message: ${accepted.text}`);
    session.send('QUIT\r\n');
  } catch (error) {
    throw error instanceof MailUnavailable ? error : new MailUnavailable(String(error));
  } finally {
    session.close();
  }
}

export async function mailReachable(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(3000);
    const settle = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}
