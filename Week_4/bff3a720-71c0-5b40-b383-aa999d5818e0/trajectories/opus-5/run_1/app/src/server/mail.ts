import { createConnection } from 'node:net';
import { config } from './config.js';

export class MailDown extends Error {
  constructor(detail: string) {
    super(`Mail transport is unavailable: ${detail}`);
    this.name = 'MailDown';
  }
}

interface Session {
  write(line: string): void;
  expect(codes: readonly number[]): Promise<void>;
  end(): void;
}

function openSession(timeoutMs: number): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    const socket = createConnection({ host: config.mail.smtpHost, port: config.mail.smtpPort });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiter: ((reply: string) => void) | null = null;
    const replies: string[] = [];

    const fail = (detail: string) => {
      socket.destroy();
      if (waiter) waiter('000 closed');
      reject(new MailDown(detail));
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        // Multi-line replies continue while the fourth character is a hyphen.
        if (line.charAt(3) !== '-') {
          if (waiter) {
            const settle = waiter;
            waiter = null;
            settle(line);
          } else {
            replies.push(line);
          }
        }
        index = buffer.indexOf('\r\n');
      }
    });
    socket.on('error', (error) => fail(String(error)));
    socket.on('timeout', () => fail('timed out'));

    const read = () =>
      new Promise<string>((settle) => {
        const queued = replies.shift();
        if (queued !== undefined) settle(queued);
        else waiter = settle;
      });

    const session: Session = {
      write: (line) => socket.write(`${line}\r\n`),
      expect: async (codes) => {
        const reply = await read();
        const code = Number.parseInt(reply.slice(0, 3), 10);
        if (!codes.includes(code)) throw new MailDown(`unexpected reply ${reply}`);
      },
      end: () => socket.end(),
    };

    socket.on('connect', () => resolve(session));
  });
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export interface Envelope {
  to: string;
  subject: string;
  body: string;
  date: Date;
}

function header(envelope: Envelope): string {
  return [
    `From: ${config.mail.from}`,
    `To: ${envelope.to}`,
    `Subject: ${envelope.subject}`,
    `Date: ${envelope.date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    '',
  ].join('\r\n');
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match ? (match[1] as string) : config.mail.from;
}

/** Hand one plain-text message to the transport. Resolves only once it is accepted. */
export async function sendMail(envelope: Envelope, timeoutMs = 5000): Promise<void> {
  const session = await openSession(timeoutMs);
  try {
    await session.expect([220]);
    session.write('EHLO longseat');
    await session.expect([250]);
    session.write(`MAIL FROM:<${fromAddress()}>`);
    await session.expect([250]);
    session.write(`RCPT TO:<${envelope.to}>`);
    await session.expect([250, 251]);
    session.write('DATA');
    await session.expect([354]);
    session.write(`${header(envelope)}${dotStuff(envelope.body)}\r\n.`);
    await session.expect([250]);
    session.write('QUIT');
  } finally {
    session.end();
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const session = await openSession(2000);
    await session.expect([220]);
    session.write('QUIT');
    session.end();
    return true;
  } catch {
    return false;
  }
}
