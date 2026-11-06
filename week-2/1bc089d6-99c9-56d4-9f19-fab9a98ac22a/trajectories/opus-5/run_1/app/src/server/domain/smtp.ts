import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

/** A plain SMTP client: one connection, one message, no authentication. */

const CONNECT_MILLIS = 1200;
const REPLY_MILLIS = 4000;

export interface Message {
  to: string;
  subject: string;
  text: string;
}

class SmtpError extends Error {}

/** The bare address inside a From value such as `Stillhour <goodnight@stillhour.example>`. */
function bareAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1]! : value).trim();
}

class Conversation {
  private buffer = '';
  private waiting: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.settle();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new SmtpError('the mail service closed the connection')));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }

  /** A reply is complete once its last line starts with `<code> ` rather than `<code>-`. */
  private settle(): void {
    if (!this.waiting) return;
    const end = this.buffer.lastIndexOf('\r\n');
    if (end < 0) return;
    const lines = this.buffer.slice(0, end).split('\r\n');
    const last = lines[lines.length - 1]!;
    if (!/^\d{3} /.test(last)) return;
    const reply = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + 2);
    const waiting = this.waiting;
    this.waiting = null;
    waiting.resolve(reply);
  }

  expect(code: string): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new SmtpError('the mail service did not answer')), REPLY_MILLIS);
      this.waiting = {
        resolve: (reply) => {
          clearTimeout(timer);
          const last = reply.split('\r\n').pop()!;
          if (!last.startsWith(code)) reject(new SmtpError(`the mail service answered ${last.slice(0, 3)}`));
          else resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.settle();
    });
  }

  say(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  write(text: string): void {
    this.socket.write(text);
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpError('the mail service did not accept a connection'));
    }, CONNECT_MILLIS);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function envelope(message: Message): string {
  const sender = bareAddress(config.mailFrom);
  const domain = sender.split('@')[1] ?? 'stillhour';
  const body = Buffer.from(message.text, 'utf8').toString('base64');
  const folded = body.replace(/(.{1,76})/g, '$1\r\n');
  return [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    folded,
  ].join('\r\n');
}

/** Hands one message to the mail service, or throws if it will not take it. */
export async function sendMail(message: Message): Promise<void> {
  const socket = await connect();
  const talk = new Conversation(socket);
  try {
    await talk.expect('220');
    talk.say('EHLO stillhour');
    await talk.expect('250');
    talk.say(`MAIL FROM:<${bareAddress(config.mailFrom)}>`);
    await talk.expect('250');
    talk.say(`RCPT TO:<${message.to}>`);
    await talk.expect('250');
    talk.say('DATA');
    await talk.expect('354');
    talk.write(`${envelope(message)}\r\n.\r\n`);
    await talk.expect('250');
    talk.say('QUIT');
  } finally {
    socket.destroy();
  }
}
