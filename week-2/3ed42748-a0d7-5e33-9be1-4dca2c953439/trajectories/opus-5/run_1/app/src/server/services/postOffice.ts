import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ServiceGate } from './availability.js';

const SESSION_TIMEOUT_MS = 5000;

class SmtpSession {
  private buffer = '';
  private waiting: { expect: number; resolve: () => void; reject: (fault: Error) => void } | null =
    null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', () => this.abort());
    socket.on('close', () => this.abort());
  }

  private abort(): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(new Error('mail session ended'));
  }

  private drain(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index]!;
      if (line.length >= 4 && line[3] === '-') continue;
      this.buffer = lines.slice(index + 1).join('\r\n');
      this.waiting = null;
      if (Number(line.slice(0, 3)) === waiting.expect) waiting.resolve();
      else waiting.reject(new Error('mail server refused a step'));
      return;
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = { expect: code, resolve, reject };
      this.drain();
    });
  }

  async say(line: string, code: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(code);
  }

  write(raw: string): void {
    this.socket.write(raw);
  }

  end(): void {
    this.socket.end();
  }
}

async function openSession(): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(SESSION_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('mail session timed out'));
    });
    socket.once('error', () => {
      socket.destroy();
      reject(new Error('mail session failed'));
    });
    socket.once('connect', () => {
      const session = new SmtpSession(socket);
      session
        .expect(220)
        .then(() => resolve(session))
        .catch(reject);
    });
  });
}

export interface OutgoingMail {
  envelopeSender: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

function encodedWords(text: string): string {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of text) {
    if (Buffer.byteLength(chunk + character, 'utf8') > 45) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks
    .map((part) => `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

/** Header text stays ASCII: a phrase is quoted, or sent as encoded words when it is not ASCII. */
function headerPhrase(phrase: string): string {
  if (ASCII_ONLY.test(phrase)) {
    return `"${phrase.replace(/([\\"])/g, '\\$1')}"`;
  }
  return encodedWords(phrase);
}

function headerText(text: string): string {
  return ASCII_ONLY.test(text) ? text : encodedWords(text);
}

export function mailbox(phrase: string, address: string): string {
  return `${headerPhrase(phrase)} <${address}>`;
}

/** Splits `Name <address>` into its phrase and address. */
export function splitMailbox(raw: string): { phrase: string; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (match) return { phrase: match[1]!.replace(/^"|"$/g, ''), address: match[2]! };
  return { phrase: '', address: raw.trim() };
}

function quotedPrintable(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  let line = '';
  const lines: string[] = [];
  for (const byte of bytes) {
    const piece =
      byte === 0x0a
        ? '\n'
        : byte >= 0x20 && byte <= 0x7e && byte !== 0x3d
          ? String.fromCharCode(byte)
          : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (piece === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (line.length + piece.length > 73) {
      lines.push(`${line}=`);
      line = '';
    }
    line += piece;
  }
  lines.push(line);
  return lines.join('\r\n');
}

function buildMessage(mail: OutgoingMail, now: Date): string {
  const ascii = ASCII_ONLY.test(mail.text.replace(/\n/g, ''));
  const headers = [
    `From: ${mail.from}`,
    `To: <${mail.to}>`,
    `Subject: ${headerText(mail.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@bramble.invalid>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${ascii ? '7bit' : 'quoted-printable'}`,
  ];
  const body = ascii ? mail.text.replace(/\n/g, '\r\n') : quotedPrintable(mail.text);
  const stuffed = body
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${stuffed}\r\n.\r\n`;
}

async function deliver(mail: OutgoingMail): Promise<void> {
  const session = await openSession();
  try {
    await session.say('EHLO bramble', 250);
    await session.say(`MAIL FROM:<${mail.envelopeSender}>`, 250);
    await session.say(`RCPT TO:<${mail.to}>`, 250);
    await session.say('DATA', 354);
    session.write(buildMessage(mail, new Date()));
    await session.expect(250);
    session.write('QUIT\r\n');
  } finally {
    session.end();
  }
}

export const postOffice = new ServiceGate('post_office_closed', async () => {
  const session = await openSession();
  session.write('QUIT\r\n');
  session.end();
});

export async function sendMail(mail: OutgoingMail): Promise<Date> {
  return postOffice.use(async () => {
    await deliver(mail);
    return new Date();
  });
}

const EMAIL_SHAPE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export type EmailFault = 'invalid' | 'too_long';

export function checkEmail(raw: unknown): { address: string } | { fault: EmailFault } {
  if (typeof raw !== 'string') return { fault: 'invalid' };
  if (raw.length > 254) return { fault: 'too_long' };
  if (!EMAIL_SHAPE.test(raw)) return { fault: 'invalid' };
  return { address: raw };
}
