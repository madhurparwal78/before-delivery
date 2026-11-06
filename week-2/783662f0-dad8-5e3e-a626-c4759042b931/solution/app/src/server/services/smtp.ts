import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

class MailUnreachable extends Error {}

interface Session {
  readonly socket: Socket;
  readonly expect: (codes: readonly number[]) => Promise<string>;
  readonly send: (line: string) => void;
}

const TIMEOUT_MS = 6000;

function open(host: string, port: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(TIMEOUT_MS);

    let buffer = '';
    let waiter: ((payload: string) => void) | null = null;
    let failer: ((error: Error) => void) | null = null;
    let settled = false;

    const die = (error: Error): void => {
      if (failer !== null) {
        const call = failer;
        waiter = null;
        failer = null;
        call(error);
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
      socket.destroy();
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // A reply ends with a line whose fourth character is a space.
      const lines = buffer.split('\r\n');
      const last = lines.filter((line) => line !== '').pop();
      if (last === undefined || last.length < 4 || last[3] === '-') return;
      const payload = buffer;
      buffer = '';
      if (waiter !== null) {
        const call = waiter;
        waiter = null;
        failer = null;
        call(payload);
      }
    });

    socket.on('timeout', () => die(new MailUnreachable('SMTP timed out')));
    socket.on('error', (error) => die(new MailUnreachable(`SMTP failed: ${error.message}`)));
    socket.on('close', () => {
      if (waiter !== null) die(new MailUnreachable('SMTP closed the connection'));
    });

    const expect = (codes: readonly number[]): Promise<string> =>
      new Promise((ok, no) => {
        waiter = (payload) => {
          const code = Number(payload.slice(0, 3));
          if (!codes.includes(code)) {
            no(new MailUnreachable(`SMTP answered ${payload.trim()}`));
            socket.destroy();
            return;
          }
          ok(payload);
        };
        failer = no;
      });

    const send = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    socket.on('connect', () => {
      settled = true;
      resolve({ socket, expect, send });
    });
  });
}

const dotStuff = (body: string): string =>
  body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

const addressOf = (from: string): string => {
  const match = /<([^>]+)>/.exec(from);
  return match !== null ? match[1] : from.trim();
};

interface Outgoing {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/** Sends one mail. It becomes sent only after the SMTP server accepts it. */
export async function sendMail(mail: Outgoing): Promise<void> {
  const { smtp, mailFrom } = config();
  const session = await open(smtp.host, smtp.port);
  try {
    await session.expect([220]);
    session.send('EHLO plotwright');
    await session.expect([250]);
    session.send(`MAIL FROM:<${addressOf(mailFrom)}>`);
    await session.expect([250]);
    session.send(`RCPT TO:<${mail.to}>`);
    await session.expect([250, 251]);
    session.send('DATA');
    await session.expect([354]);

    const headers = [
      `From: ${mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    session.socket.write(`${headers}\r\n\r\n${dotStuff(mail.body)}\r\n.\r\n`);
    await session.expect([250]);
    session.send('QUIT');
  } finally {
    session.socket.destroy();
  }
}
