import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

/** Thrown when outgoing mail cannot be handed to the SMTP server. */
export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

interface Session {
  send(command: string, expected: number): Promise<void>;
  close(): void;
}

function openSession(host: string, port: number, timeoutMs: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let pending: { expected: number; resolve: () => void; reject: (e: Error) => void } | null =
      null;

    const fail = (error: Error): void => {
      pending?.reject(error);
      pending = null;
      socket.destroy();
      reject(error);
    };

    socket.on('timeout', () => fail(new MailError('SMTP timed out')));
    socket.on('error', (error) => fail(new MailError(`SMTP failed: ${error.message}`)));

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // A reply ends on a line whose fourth character is a space.
      const lines = buffer.split('\r\n');
      const last = lines.filter((l) => l !== '').pop();
      if (last === undefined || last[3] === '-') return;
      const code = Number.parseInt(last.slice(0, 3), 10);
      const reply = buffer;
      buffer = '';
      if (pending === null) {
        if (code === 220) {
          resolve({
            send(command, expected) {
              return new Promise<void>((ok, no) => {
                pending = { expected, resolve: ok, reject: no };
                socket.write(command);
              });
            },
            close() {
              socket.end();
            },
          });
        } else {
          fail(new MailError(`SMTP greeting was ${reply.trim()}`));
        }
        return;
      }
      const waiting = pending;
      pending = null;
      if (code === waiting.expected) waiting.resolve();
      else waiting.reject(new MailError(`SMTP answered ${reply.trim()}`));
    });
  });
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

function buildMessage(to: string, subject: string, body: string): string {
  const base64 = Buffer.from(body, 'utf8').toString('base64');
  const wrapped = base64.replace(/(.{76})/g, '$1\r\n');
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@turnstone.studio>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrapped}`;
}

/** Hands one message to the SMTP server. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const session = await openSession(config.mail.host, config.mail.port, 10_000);
  try {
    await session.send('EHLO turnstone-studio\r\n', 250);
    await session.send(`MAIL FROM:<${addressOf(config.mail.from)}>\r\n`, 250);
    await session.send(`RCPT TO:<${to}>\r\n`, 250);
    await session.send('DATA\r\n', 354);
    const message = buildMessage(to, subject, body).replace(/\r\n\./g, '\r\n..');
    await session.send(`${message}\r\n.\r\n`, 250);
    await session.send('QUIT\r\n', 221).catch(() => undefined);
  } finally {
    session.close();
  }
}

export async function mailUp(): Promise<boolean> {
  try {
    const session = await openSession(config.mail.host, config.mail.port, 3_000);
    await session.send('QUIT\r\n', 221).catch(() => undefined);
    session.close();
    return true;
  } catch {
    return false;
  }
}
