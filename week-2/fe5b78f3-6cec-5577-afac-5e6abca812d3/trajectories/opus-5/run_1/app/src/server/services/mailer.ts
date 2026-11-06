import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import type { Config } from '../config';

export class MailUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Mailpit is unreachable');
    this.name = 'MailUnavailableError';
    this.cause = cause;
  }
}

export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
}

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly attachments?: readonly MailAttachment[];
}

const TIMEOUT_MS = 8_000;

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from.trim() : match[1];
}

function encodeHeader(value: string): string {
  if (/^[ -~]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(content: Buffer): string {
  const encoded = content.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function buildMessage(from: string, mail: Mail, date: Date): string {
  const headers = [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${randomUUID()}@pakka-rail.example>`,
    'MIME-Version: 1.0',
  ];
  const attachments = mail.attachments ?? [];
  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(Buffer.from(mail.body, 'utf8'))}\r\n`;
  }
  const boundary = `pakka-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(mail.body, 'utf8')),
  ];
  for (const attachment of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      wrapBase64(attachment.content),
    );
  }
  parts.push(`--${boundary}--`, '');
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

function dotStuff(message: string): string {
  return message.split('\r\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.drain();
    });
    socket.on('close', () => {
      if (this.failure === null) this.failure = new Error('SMTP connection closed');
      this.drain();
    });
  }

  private drain(): void {
    if (this.pending === null) return;
    const complete = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (complete !== null) {
      const response = this.buffer.slice(0, complete.index + complete[0].length);
      this.buffer = this.buffer.slice(complete.index + complete[0].length);
      const resolve = this.pending;
      this.pending = null;
      resolve(response.trim());
      return;
    }
    if (this.failure !== null) {
      const resolve = this.pending;
      this.pending = null;
      resolve('');
    }
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failure !== null && this.buffer.length === 0) {
        reject(this.failure);
        return;
      }
      this.pending = (line) => {
        if (line === '' && this.failure !== null) reject(this.failure);
        else resolve(line);
      };
      this.drain();
    });
  }

  write(line: string): void {
    this.socket.write(line);
  }

  async command(line: string, expected: number): Promise<void> {
    this.write(line);
    const response = await this.read();
    const match = /(\d{3})[^\r\n]*$/.exec(response.trim());
    if (match === null || Number.parseInt(match[1], 10) !== expected) {
      throw new Error(`SMTP ${line.trim()} answered ${response}`);
    }
  }

  end(): void {
    this.socket.destroy();
  }
}

export class Mailer {
  constructor(private readonly config: Config) {}

  /** Mail goes only to the booking account's email, from the MAIL_FROM address. */
  async send(mail: Mail): Promise<void> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const connection = createConnection({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        timeout: TIMEOUT_MS,
      });
      connection.once('connect', () => resolve(connection));
      connection.once('timeout', () => {
        connection.destroy();
        reject(new MailUnavailableError(new Error('SMTP connect timed out')));
      });
      connection.once('error', (error) => reject(new MailUnavailableError(error)));
    });
    const session = new SmtpSession(socket);
    try {
      await session.read();
      await session.command('EHLO pakka-rail\r\n', 250);
      await session.command(`MAIL FROM:<${envelopeAddress(this.config.smtp.from)}>\r\n`, 250);
      await session.command(`RCPT TO:<${mail.to}>\r\n`, 250);
      await session.command('DATA\r\n', 354);
      const message = buildMessage(this.config.smtp.from, mail, new Date());
      session.write(`${dotStuff(message)}\r\n.\r\n`);
      const accepted = await session.read();
      if (!accepted.includes('250')) throw new Error(`SMTP refused the message: ${accepted}`);
      session.write('QUIT\r\n');
    } catch (error) {
      throw new MailUnavailableError(error);
    } finally {
      session.end();
    }
  }
}
