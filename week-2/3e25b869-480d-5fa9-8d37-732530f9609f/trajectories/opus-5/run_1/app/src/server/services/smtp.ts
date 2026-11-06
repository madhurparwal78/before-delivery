import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

export class MailUnavailableError extends Error {
  constructor() {
    super('mail server unreachable');
  }
}

const CONNECT_TIMEOUT_MS = 5_000;
const EHLO_NAME = 'loafline';

type Reply = { code: number; text: string };

class Dialogue {
  private readonly socket: Socket;
  private buffer = '';
  private pending: ((reply: Reply | Error) => void) | null = null;
  private queued: (Reply | Error)[] = [];

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.consume(chunk));
    socket.on('error', () => this.deliver(new MailUnavailableError()));
    socket.on('close', () => this.deliver(new MailUnavailableError()));
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      // Multi-line replies repeat the code with a hyphen until the final line.
      if (/^\d{3}-/.test(line)) continue;
      const match = /^(\d{3})\s?(.*)$/.exec(line);
      if (!match) continue;
      this.deliver({ code: Number(match[1]), text: match[2] ?? '' });
    }
  }

  private deliver(reply: Reply | Error): void {
    const waiter = this.pending;
    if (waiter) {
      this.pending = null;
      waiter(reply);
      return;
    }
    this.queued.push(reply);
  }

  private next(): Promise<Reply> {
    const queued = this.queued.shift();
    if (queued) return queued instanceof Error ? Promise.reject(queued) : Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      this.pending = (reply) => (reply instanceof Error ? reject(reply) : resolve(reply));
    });
  }

  async expect(codes: readonly number[]): Promise<Reply> {
    const reply = await this.next();
    if (!codes.includes(reply.code)) throw new MailUnavailableError();
    return reply;
  }

  async command(line: string, codes: readonly number[]): Promise<Reply> {
    this.socket.write(`${line}\r\n`);
    return this.expect(codes);
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  close(): void {
    this.socket.destroy();
  }
}

async function connect(): Promise<Dialogue> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    const fail = (): void => {
      socket.destroy();
      reject(new MailUnavailableError());
    };
    socket.once('error', fail);
    socket.once('timeout', fail);
    socket.once('connect', () => {
      socket.setTimeout(0);
      socket.removeListener('error', fail);
      socket.removeListener('timeout', fail);
      resolve(new Dialogue(socket));
    });
  });
}

export type OutgoingMessage = {
  to: string;
  subject: string;
  messageId: string;
  body: string;
};

function bareAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Lines(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function renderMessage(message: OutgoingMessage): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${base64Lines(message.body)}\r\n`;
}

export const smtp = {
  /** Opens an SMTP connection and closes it, which is the mail-server health check. */
  async probe(): Promise<void> {
    const dialogue = await connect();
    try {
      await dialogue.expect([220]);
      await dialogue.command(`EHLO ${EHLO_NAME}`, [250]);
      await dialogue.command('QUIT', [221]);
    } finally {
      dialogue.close();
    }
  },

  async send(message: OutgoingMessage): Promise<void> {
    const dialogue = await connect();
    try {
      await dialogue.expect([220]);
      await dialogue.command(`EHLO ${EHLO_NAME}`, [250]);
      await dialogue.command(`MAIL FROM:<${bareAddress(config.mailFrom)}>`, [250]);
      await dialogue.command(`RCPT TO:<${message.to}>`, [250, 251]);
      await dialogue.command('DATA', [354]);
      dialogue.write(renderMessage(message));
      await dialogue.command('.', [250]);
      await dialogue.command('QUIT', [221]);
    } finally {
      dialogue.close();
    }
  },
};
