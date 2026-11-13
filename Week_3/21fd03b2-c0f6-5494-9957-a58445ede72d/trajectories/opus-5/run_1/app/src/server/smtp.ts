import net from 'node:net';
import { config } from './config.js';

export class MailDown extends Error {}

interface Session {
  socket: net.Socket;
  read: () => Promise<string>;
}

function openSession(): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8_000);
    let buffer = '';
    let waiting: ((line: string) => void) | null = null;
    const fail = (error: Error): void => {
      socket.destroy();
      reject(new MailDown(error.message));
    };
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('mail timed out')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const complete = /(?:^|\n)\d{3} [^\n]*\r?\n$/.test(buffer);
      if (complete && waiting) {
        const reply = buffer;
        buffer = '';
        const notify = waiting;
        waiting = null;
        notify(reply);
      }
    });
    const read = (): Promise<string> =>
      new Promise<string>((resolveRead, rejectRead) => {
        const timer = setTimeout(() => rejectRead(new MailDown('mail timed out')), 8_000);
        waiting = (line: string) => {
          clearTimeout(timer);
          resolveRead(line);
        };
        if (buffer !== '' && /(?:^|\n)\d{3} [^\n]*\r?\n$/.test(buffer)) {
          const reply = buffer;
          buffer = '';
          waiting = null;
          clearTimeout(timer);
          resolveRead(reply);
        }
      });
    socket.once('connect', () => {
      socket.removeListener('error', fail);
      socket.on('error', () => undefined);
      resolve({ socket, read });
    });
  });
}

async function expect(session: Session, prefix: string): Promise<void> {
  const reply = await session.read();
  const last = reply.trimEnd().split('\n').pop() ?? '';
  if (!last.startsWith(prefix)) throw new MailDown(`mail server said ${last.trim()}`);
}

function write(session: Session, line: string): void {
  session.socket.write(`${line}\r\n`);
}

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return match ? match[1] : config.smtp.from;
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Sends one plain-text message with one recipient, or throws MailDown. */
export async function sendMail(message: Message): Promise<void> {
  const session = await openSession();
  try {
    await expect(session, '220');
    write(session, 'EHLO rampwright');
    await expect(session, '250');
    write(session, `MAIL FROM:<${fromAddress()}>`);
    await expect(session, '250');
    write(session, `RCPT TO:<${message.to}>`);
    await expect(session, '250');
    write(session, 'DATA');
    await expect(session, '354');
    const headers = [
      `From: ${config.smtp.from}`,
      `To: <${message.to}>`,
      `Subject: ${encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    const dotted = message.body
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    write(session, `${headers}\r\n\r\n${dotted}\r\n.`);
    await expect(session, '250');
    write(session, 'QUIT');
  } finally {
    session.socket.destroy();
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const session = await openSession();
    await expect(session, '220');
    write(session, 'QUIT');
    session.socket.destroy();
    return true;
  } catch {
    return false;
  }
}
