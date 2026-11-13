import { createConnection, type Socket } from 'node:net';
import { config, mailFrom } from '../config.js';

const CONNECT_TIMEOUT_MS = 4000;

export class MailUnreachable extends Error {}

interface Conversation {
  send(line: string, expect: number): Promise<void>;
  sendData(payload: string): Promise<void>;
  close(): void;
}

function open(): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    let buffer = '';
    let waiting: { expect: number; resolve: () => void; reject: (cause: Error) => void } | null = null;

    const fail = (cause: Error): void => {
      const pending = waiting;
      waiting = null;
      socket.destroy();
      if (pending) pending.reject(cause);
      else reject(cause);
    };

    socket.on('error', (cause) => fail(new MailUnreachable(cause.message)));
    socket.on('timeout', () => fail(new MailUnreachable('SMTP timed out')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n').filter((line) => line !== '');
      const last = lines.at(-1);
      // A multi-line reply keeps a hyphen after the code; a space marks the final line.
      const final = last ? /^(\d{3}) /.exec(last) : null;
      if (!final || !buffer.endsWith('\r\n') || !waiting) return;
      const pending = waiting;
      waiting = null;
      buffer = '';
      if (Number(final[1]) !== pending.expect) {
        socket.destroy();
        pending.reject(new MailUnreachable(`SMTP expected ${pending.expect}, got ${final[1]}`));
        return;
      }
      pending.resolve();
    });

    const expect = (code: number): Promise<void> =>
      new Promise((done, failed) => {
        waiting = { expect: code, resolve: done, reject: failed };
      });

    const conversation: Conversation = {
      async send(line, code) {
        const reply = expect(code);
        socket.write(`${line}\r\n`);
        await reply;
      },
      async sendData(payload) {
        const reply = expect(250);
        socket.write(payload);
        socket.write('\r\n.\r\n');
        await reply;
      },
      close() {
        socket.write('QUIT\r\n');
        socket.end();
      },
    };

    // The catch is attached straight away, so a refused connection rejects rather than escaping.
    expect(220)
      .then(() => resolve(conversation))
      .catch(reject);
  });
}

function encodeHeader(value: string): string {
  if (!/[^\u0020-\u007e]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

export interface Notice {
  recipient: string;
  subject: string;
  body: string;
}

/** Sends one plain-text message. A refusal or an unreachable host throws MailUnreachable. */
export async function sendNotice(notice: Notice): Promise<void> {
  const conversation = await open();
  try {
    await conversation.send('EHLO keelson', 250);
    await conversation.send(`MAIL FROM:<${mailFrom.address}>`, 250);
    await conversation.send(`RCPT TO:<${notice.recipient}>`, 250);
    await conversation.send('DATA', 354);
    const headers = [
      `From: ${encodeHeader(mailFrom.name)} <${mailFrom.address}>`,
      `To: <${notice.recipient}>`,
      `Subject: ${encodeHeader(notice.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    await conversation.sendData(`${headers}\r\n\r\n${dotStuff(notice.body)}`);
    conversation.close();
  } catch (cause) {
    if (cause instanceof MailUnreachable) throw cause;
    throw new MailUnreachable(String(cause));
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const conversation = await open();
    await conversation.send('EHLO keelson', 250);
    conversation.close();
    return true;
  } catch {
    return false;
  }
}
