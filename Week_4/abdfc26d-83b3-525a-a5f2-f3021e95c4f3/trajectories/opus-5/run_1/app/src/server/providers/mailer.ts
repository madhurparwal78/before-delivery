import { randomBytes } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

const CONNECT_TIMEOUT_MS = 10_000;

/** The SMTP server could not be reached or refused the message. */
export class MailUnavailable extends Error {
  constructor(cause: unknown) {
    super('Mail is down');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

export interface Attachment {
  readonly filename: string;
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly attachment: Attachment | null;
}

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function addressOnly(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

function wrapBase64(bytes: Buffer): string {
  return (bytes.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function buildMessage(mail: OutgoingMail): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeaderValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@phosphene-yard>`,
    'MIME-Version: 1.0',
  ];

  if (!mail.attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(Buffer.from(mail.text, 'utf8'))}\r\n`;
  }

  const boundary = `py-${randomBytes(12).toString('hex')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(mail.text, 'utf8')),
    `--${boundary}`,
    `Content-Type: ${mail.attachment.contentType}; name="${mail.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${mail.attachment.filename}"`,
    '',
    wrapBase64(mail.attachment.bytes),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

/** Dot-stuffing, so a line of a single dot inside the body does not end DATA. */
function stuffDots(message: string): string {
  return message.replace(/\r\n\./g, '\r\n..');
}

interface SmtpSession {
  send(command: string, expected: number): Promise<string>;
  close(): void;
}

function openSession(): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    let buffer = '';
    let waiting: { expected: number; resolve: (line: string) => void; reject: (e: unknown) => void } | null =
      null;
    let greeted = false;

    const fail = (error: unknown): void => {
      const pending = waiting;
      waiting = null;
      socket.destroy();
      if (pending) pending.reject(new MailUnavailable(error));
      else if (!greeted) reject(new MailUnavailable(error));
    };

    socket.on('timeout', () => fail('SMTP timed out'));
    socket.on('error', fail);
    socket.on('close', () => {
      if (waiting) fail('SMTP closed early');
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // A reply ends with a line whose fourth character is a space.
      const match = /^(\d{3}) [^\r\n]*\r\n/m.exec(buffer);
      if (!match) return;
      const reply = buffer;
      const code = Number.parseInt(match[1] ?? '0', 10);
      buffer = '';

      if (!greeted) {
        greeted = true;
        if (code !== 220) {
          fail(`SMTP greeting was ${code}`);
          return;
        }
        resolve({
          send: (command, expected) =>
            new Promise<string>((resolveSend, rejectSend) => {
              waiting = { expected, resolve: resolveSend, reject: rejectSend };
              socket.write(command.endsWith('\r\n') ? command : `${command}\r\n`);
            }),
          close: () => socket.destroy(),
        });
        return;
      }

      const pending = waiting;
      waiting = null;
      if (!pending) return;
      if (code !== pending.expected) {
        pending.reject(new MailUnavailable(`SMTP answered ${reply.trim()}`));
        socket.destroy();
        return;
      }
      pending.resolve(reply);
    });
  });
}

/** Delivers one message. It is marked sent only after the server accepts it. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const session = await openSession();
  try {
    await session.send('EHLO phosphene-yard', 250);
    await session.send(`MAIL FROM:<${addressOnly(config.mailFrom)}>`, 250);
    await session.send(`RCPT TO:<${mail.to}>`, 250);
    await session.send('DATA', 354);
    await session.send(`${stuffDots(buildMessage(mail))}\r\n.`, 250);
    await session.send('QUIT', 221).catch(() => undefined);
  } finally {
    session.close();
  }
}

export async function probeMail(): Promise<boolean> {
  try {
    const session = await openSession();
    await session.send('QUIT', 221).catch(() => undefined);
    session.close();
    return true;
  } catch {
    return false;
  }
}
