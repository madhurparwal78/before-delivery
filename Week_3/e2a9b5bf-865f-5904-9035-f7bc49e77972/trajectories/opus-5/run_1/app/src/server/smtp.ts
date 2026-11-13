import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { config, PROVIDER_TIMEOUT_MS } from './config.js';

/** SMTP is down when it can't be reached or sends no greeting in time. */
export class SmtpDown extends Error {}
/** SMTP answered, but refused the message. */
export class SmtpRejected extends Error {}

export interface MailAddress {
  name: string;
  address: string;
}

export interface Mail {
  to: MailAddress;
  cc: string;
  subject: string;
  text: string;
  attachment: { filename: string; bytes: Uint8Array };
}

class SmtpSession {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', () => this.fail(new SmtpDown('smtp connection failed')));
    socket.on('close', () => this.fail(new SmtpDown('smtp connection closed')));
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.drain();
  }

  private drain(): void {
    if (!this.waiting) return;
    // A reply ends on a line whose fourth character is a space.
    const lines = this.buffer.split('\r\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] ?? '';
      if (line.length >= 4 && line[3] === ' ') {
        const consumed = lines.slice(0, index + 1).join('\r\n').length + 2;
        const reply = lines.slice(0, index + 1).join('\n');
        this.buffer = this.buffer.slice(consumed);
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.(reply);
        return;
      }
    }
    if (this.failure && this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve('');
    }
  }

  async expect(codes: readonly number[]): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
    if (reply === '') throw this.failure ?? new SmtpDown('smtp stopped answering');
    const code = Number(reply.slice(0, 3));
    if (!codes.includes(code)) {
      if (code >= 400) throw new SmtpRejected(`smtp replied ${code}`);
      throw new SmtpDown('smtp replied unexpectedly');
    }
  }

  send(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  sendRaw(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpDown('smtp did not connect in time'));
    }, PROVIDER_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new SmtpDown('smtp could not be reached'));
    });
  });
}

function needsEncoding(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x20-\x7e]/.test(value);
}

/** RFC 2047, so a display name reaches the decoded header literally. */
function encodeHeaderText(value: string): string {
  if (!needsEncoding(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function encodeAddress(address: MailAddress): string {
  const name = needsEncoding(address.name)
    ? encodeHeaderText(address.name)
    : `"${address.name.replace(/([\\"])/g, '\\$1')}"`;
  return `${name} <${address.address}>`;
}

function base64Lines(bytes: Uint8Array): string {
  const encoded = Buffer.from(bytes).toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function buildMessage(mail: Mail, boundary: string): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${encodeAddress(mail.to)}`,
    `Cc: ${mail.cc}`,
    `Subject: ${encodeHeaderText(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(mail.text, 'utf8')),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${mail.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${mail.attachment.filename}"`,
    '',
    base64Lines(mail.attachment.bytes),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}`;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return match?.[1] ?? config.mailFrom.trim();
}

function dotStuff(message: string): string {
  return message.replace(/\r\n\./g, '\r\n..');
}

/** Send one message. A fresh connection each time, with no remembered state. */
export async function sendMail(mail: Mail): Promise<void> {
  const socket = await connect();
  const session = new SmtpSession(socket);
  const deadline = setTimeout(() => socket.destroy(), PROVIDER_TIMEOUT_MS);
  try {
    await session.expect([220]);
    session.send('EHLO lowlamp');
    await session.expect([250]);
    session.send(`MAIL FROM:<${senderAddress()}>`);
    await session.expect([250]);
    session.send(`RCPT TO:<${mail.to.address}>`);
    await session.expect([250, 251]);
    session.send(`RCPT TO:<${mail.cc}>`);
    await session.expect([250, 251]);
    session.send('DATA');
    await session.expect([354]);
    const boundary = `lowlamp-${randomBytes(12).toString('hex')}`;
    session.sendRaw(`${dotStuff(buildMessage(mail, boundary))}\r\n.\r\n`);
    await session.expect([250]);
    session.send('QUIT');
  } finally {
    clearTimeout(deadline);
    session.end();
  }
}
