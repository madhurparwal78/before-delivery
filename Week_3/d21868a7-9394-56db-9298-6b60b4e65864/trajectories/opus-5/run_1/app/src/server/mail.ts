import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { config } from './config.ts';

/** The mail service. Every message comes from MAIL_FROM. */

export class MailUnavailableError extends Error {}

export interface Attachment {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface Message {
  to: string;
  subject: string;
  body: string;
  attachment?: Attachment;
}

function addressOf(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return angled === null ? mailbox.trim() : (angled[1] as string).trim();
}

function base64Lines(bytes: Buffer): string {
  const encoded = bytes.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) lines.push(encoded.slice(index, index + 76));
  return lines.join('\r\n');
}

function compose(message: Message): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@wirrinbah.example>`,
    'MIME-Version: 1.0',
  ];

  if (message.attachment === undefined) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${base64Lines(Buffer.from(message.body, 'utf8'))}\r\n`;
  }

  const boundary = `ditchbook-${randomBytes(12).toString('hex')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(message.body, 'utf8')),
    `--${boundary}`,
    `Content-Type: ${message.attachment.contentType}; name="${message.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${message.attachment.filename}"`,
    '',
    base64Lines(message.attachment.bytes),
    `--${boundary}--`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`;
}

interface Session {
  command: (line: string | null, expected: number) => Promise<void>;
  end: () => void;
}

function openSession(): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(8000);
    let buffer = '';
    let pending: { expected: number; resolve: () => void; reject: (error: Error) => void } | null = null;

    const fail = (error: Error): void => {
      const waiting = pending;
      pending = null;
      socket.destroy();
      if (waiting === null) reject(error);
      else waiting.reject(error);
    };

    socket.on('error', () => fail(new MailUnavailableError('The mail service is not answering.')));
    socket.on('timeout', () => fail(new MailUnavailableError('The mail service is not answering.')));
    socket.on('close', () => {
      if (pending !== null) fail(new MailUnavailableError('The mail service closed the connection.'));
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (pending === null) return;
      // A reply is complete once its last line carries a space after the code.
      const complete = /(?:^|\n)(\d{3}) [^\n]*\r?\n$/.exec(buffer);
      if (complete === null) return;
      const code = Number(complete[1]);
      const waiting = pending;
      pending = null;
      buffer = '';
      if (Math.floor(code / 100) === Math.floor(waiting.expected / 100)) waiting.resolve();
      else waiting.reject(new MailUnavailableError(`The mail service answered ${code}.`));
    });

    const command = (line: string | null, expected: number): Promise<void> =>
      new Promise((done, failed) => {
        pending = { expected, resolve: done, reject: failed };
        if (line !== null) socket.write(`${line}\r\n`);
      });

    socket.on('connect', () => {
      command(null, 220)
        .then(() => resolve({ command, end: () => socket.destroy() }))
        .catch(reject);
    });
  });
}

export async function sendMail(message: Message): Promise<void> {
  const session = await openSession();
  try {
    await session.command('EHLO ditchbook', 250);
    await session.command(`MAIL FROM:<${addressOf(config.mail.from)}>`, 250);
    await session.command(`RCPT TO:<${addressOf(message.to)}>`, 250);
    await session.command('DATA', 354);
    const data = compose(message)
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    await session.command(`${data}\r\n.`, 250);
    await session.command('QUIT', 221);
  } finally {
    session.end();
  }
}
