import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { budgetName, firstName, projectTypeName } from '../shared/copy.js';
import type { MailOutcome, StoredEnquiry } from '../shared/types.js';

const MAIL_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 2000;

interface Message {
  to: string;
  replyTo: string | null;
  subject: string;
  text: string;
}

interface Reply {
  code: number;
}

const senderAddress = (): string => {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return match ? match[1]! : config.mailFrom;
};

const senderDomain = (): string => senderAddress().split('@')[1]!;

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 36) {
      words.push(chunk.join(''));
      chunk = [];
      bytes = 0;
    }
    chunk.push(character);
    bytes += size;
  }
  words.push(chunk.join(''));
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

const hex = (byte: number): string => `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * Encodes the text so that every line break travels as the escape =0A. The decoded
 * message then holds the stored text character for character, whatever the line
 * endings of the transport.
 */
function quotedPrintable(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  const pieces: string[] = [];
  let current = '';
  for (const byte of bytes) {
    const token = byte !== 61 && byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : hex(byte);
    if (current.length + token.length > 75) {
      const last = current.slice(-1);
      const head =
        last === ' ' || last === '\t'
          ? `${current.slice(0, -1)}${hex(last.charCodeAt(0))}`
          : current;
      pieces.push(`${head}=`);
      current = '';
    }
    current += token;
  }
  pieces.push(current);
  return pieces.join('\r\n');
}

function rfc2822Date(when: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${days[when.getUTCDay()]}, ${pad(when.getUTCDate())} ${months[when.getUTCMonth()]} ` +
    `${when.getUTCFullYear()} ${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:` +
    `${pad(when.getUTCSeconds())} +0000`
  );
}

function serialise(message: Message): string {
  const headers = [
    `From: ${encodeHeaderValue(config.mailFrom)}`,
    `To: ${message.to}`,
    ...(message.replyTo === null ? [] : [`Reply-To: ${message.replyTo}`]),
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${rfc2822Date(new Date())}`,
    `Message-ID: <${randomUUID()}@${senderDomain()}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${quotedPrintable(message.text)}`;
}

class SmtpConnection {
  private readonly socket: net.Socket;
  private buffer = '';
  private readonly replies: Reply[] = [];
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null =
    null;
  private failure: Error | null = null;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.take(chunk));
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('The mail server closed the connection.')));
  }

  static async open(host: string, port: number, timeout: number): Promise<SmtpConnection> {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeout, () => socket.destroy(new Error('The mail server timed out.')));
    const connection = new SmtpConnection(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    return connection;
  }

  private take(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(this.buffer);
      if (!match) return;
      const reply: Reply = { code: Number(match[1]) };
      this.buffer = this.buffer.slice(match[0].length);
      const waiting = this.waiting;
      if (waiting) {
        this.waiting = null;
        waiting.resolve(reply);
      } else {
        this.replies.push(reply);
      }
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = null;
      waiting.reject(error);
    }
  }

  private reply(): Promise<Reply> {
    const queued = this.replies.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<Reply>((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  async expect(expected: number): Promise<void> {
    const reply = await this.reply();
    if (reply.code !== expected) {
      throw new Error(`The mail server answered ${reply.code}.`);
    }
  }

  write(data: string): void {
    this.socket.write(data);
  }

  async command(line: string, expected: number): Promise<void> {
    this.write(`${line}\r\n`);
    await this.expect(expected);
  }

  close(): void {
    this.socket.destroy();
  }
}

async function session(messages: Message[], timeout: number): Promise<void> {
  const connection = await SmtpConnection.open(config.smtpHost, config.smtpPort, timeout);
  try {
    await connection.expect(220);
    await connection.command(`EHLO ${senderDomain()}`, 250);
    for (const message of messages) {
      await connection.command(`MAIL FROM:<${senderAddress()}>`, 250);
      await connection.command(`RCPT TO:<${message.to}>`, 250);
      await connection.command('DATA', 354);
      const body = serialise(message)
        .split('\r\n')
        .map((line) => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n');
      connection.write(`${body}\r\n.\r\n`);
      await connection.expect(250);
    }
    connection.write('QUIT\r\n');
  } finally {
    connection.close();
  }
}

function fieldLines(enquiry: StoredEnquiry): string {
  return [
    `Reference: ${enquiry.reference}`,
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    `Project type: ${projectTypeName(enquiry.projectType)}`,
    `Budget range: ${budgetName(enquiry.budget)}`,
    '',
    'Project description:',
    enquiry.description,
  ].join('\n');
}

function enquiryMessages(enquiry: StoredEnquiry): Message[] {
  const fields = fieldLines(enquiry);
  return [
    {
      to: config.studioEmail,
      replyTo: enquiry.email,
      subject: `New enquiry ${enquiry.reference} · ${projectTypeName(enquiry.projectType)} · ${budgetName(enquiry.budget)}`,
      text: fields,
    },
    {
      to: enquiry.email,
      replyTo: null,
      subject: `Your enquiry ${enquiry.reference} to Sollis Studio`,
      text: [
        `Hello ${firstName(enquiry.name)},`,
        '',
        'Thank you for your enquiry. Maren will reply within two working days.',
        '',
        fields,
      ].join('\n'),
    },
  ];
}

export async function sendEnquiryMessages(enquiry: StoredEnquiry): Promise<MailOutcome> {
  try {
    await session(enquiryMessages(enquiry), MAIL_TIMEOUT_MS);
    return 'sent';
  } catch {
    return 'not_sent';
  }
}

export async function mailServerReachable(): Promise<boolean> {
  try {
    const connection = await SmtpConnection.open(
      config.smtpHost,
      config.smtpPort,
      HEALTH_TIMEOUT_MS,
    );
    try {
      await connection.expect(220);
      await connection.command(`EHLO ${senderDomain()}`, 250);
      connection.write('QUIT\r\n');
      return true;
    } finally {
      connection.close();
    }
  } catch {
    return false;
  }
}
