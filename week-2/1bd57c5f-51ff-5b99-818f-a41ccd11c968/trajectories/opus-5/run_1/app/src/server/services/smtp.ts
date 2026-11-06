import { createConnection, type Socket } from 'node:net';
import { config } from '../env.js';

export class MailUnavailable extends Error {}

export type Message = {
  to: string;
  subject: string;
  body: string;
};

/** A plain SMTP dialogue: no authentication and no TLS, as the mail server is provided. */
class Dialogue {
  private buffer = '';
  private waiting: { resolve: (code: number) => void; reject: (error: Error) => void } | null = null;
  private broken: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (error) => this.onBroken(new MailUnavailable(String(error))));
    socket.on('timeout', () => {
      this.onBroken(new MailUnavailable('smtp timeout'));
      socket.destroy();
    });
    socket.on('close', () => this.onBroken(new MailUnavailable('smtp closed')));
  }

  static open(host: string, port: number, timeoutMs: number): Promise<Dialogue> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      socket.setTimeout(timeoutMs);
      socket.once('error', (error) => reject(new MailUnavailable(String(error))));
      socket.once('connect', () => resolve(new Dialogue(socket)));
    });
  }

  private onBroken(error: Error): void {
    this.broken = error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const match = /(?:^|\n)(\d{3}) [^\n]*\r?\n$/.exec(this.buffer);
    if (!match || !this.waiting) return;
    this.buffer = '';
    const waiting = this.waiting;
    this.waiting = null;
    waiting.resolve(Number(match[1]));
  }

  expect(codes: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.broken) {
        reject(this.broken);
        return;
      }
      this.waiting = {
        resolve: (code) =>
          codes.includes(code) ? resolve() : reject(new MailUnavailable(`smtp replied ${code}`)),
        reject,
      };
    });
  }

  write(text: string): void {
    this.socket.write(text);
  }

  line(text: string): void {
    this.socket.write(text + '\r\n');
  }

  close(): void {
    this.socket.removeAllListeners('close');
    this.socket.destroy();
  }
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n');
}

function encodeHeader(value: string): string {
  return /^[ -~]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return match ? match[1] : config.mailFrom;
}

export async function sendMessage(message: Message, at: Date): Promise<void> {
  const dialogue = await Dialogue.open(config.smtp.host, config.smtp.port, 10_000);
  try {
    await dialogue.expect([220]);
    dialogue.line('EHLO snaglight');
    await dialogue.expect([250]);
    dialogue.line(`MAIL FROM:<${senderAddress()}>`);
    await dialogue.expect([250]);
    dialogue.line(`RCPT TO:<${message.to}>`);
    await dialogue.expect([250, 251]);
    dialogue.line('DATA');
    await dialogue.expect([354]);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${at.toUTCString().replace('GMT', '+0000')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    dialogue.write(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    await dialogue.expect([250]);
    dialogue.line('QUIT');
  } finally {
    dialogue.close();
  }
}
