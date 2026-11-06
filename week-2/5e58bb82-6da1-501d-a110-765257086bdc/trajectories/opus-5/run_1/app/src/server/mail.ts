import { createConnection, type Socket } from 'node:net';
import { config } from './config.js';

/**
 * A minimal SMTP client. One separate message per recipient, with only that
 * recipient in To and no Cc or Bcc.
 */
export class MailUnreachable extends Error {
  constructor() {
    super('mail unreachable');
  }
}

const CONNECT_TIMEOUT_MS = 3000;

interface Session {
  socket: Socket;
  read(expected: number): Promise<void>;
  write(line: string): void;
  end(): void;
}

function openSession(timeoutMs: number): Promise<Session> {
  return new Promise((settle, fail) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    let buffer = '';
    let pending: { expected: number; settle: () => void; fail: (error: Error) => void } | null = null;
    const timer = setTimeout(() => {
      socket.destroy();
      fail(new MailUnreachable());
    }, timeoutMs);

    const tryResolve = (): void => {
      if (!pending) return;
      const match = /^(\d{3})(?: |-)/m.exec(buffer);
      if (!match) return;
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
      const last = lines[lines.length - 1] ?? '';
      if (/^\d{3}-/.test(last)) return;
      const code = Number(match[1]);
      const waiting = pending;
      pending = null;
      buffer = '';
      if (Math.floor(code / 100) === Math.floor(waiting.expected / 100)) waiting.settle();
      else waiting.fail(new MailUnreachable());
    };

    socket.setTimeout(timeoutMs);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      tryResolve();
    });
    socket.on('error', () => {
      clearTimeout(timer);
      const waiting = pending;
      pending = null;
      if (waiting) waiting.fail(new MailUnreachable());
      else fail(new MailUnreachable());
    });
    socket.on('timeout', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(timer);
      const waiting = pending;
      pending = null;
      if (waiting) waiting.fail(new MailUnreachable());
    });

    const session: Session = {
      socket,
      read: (expected) =>
        new Promise<void>((done, failRead) => {
          pending = { expected, settle: done, fail: failRead };
          tryResolve();
        }),
      write: (line) => {
        socket.write(`${line}\r\n`);
      },
      end: () => {
        clearTimeout(timer);
        socket.destroy();
      },
    };

    socket.on('connect', () => {
      clearTimeout(timer);
      settle(session);
    });
  });
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return match ? match[1]! : config.mailFrom;
}

/** Headers never carry Cc or Bcc, and From and Reply-To are both MAIL_FROM. */
function message(to: string, subject: string, body: string): string {
  const headers = [
    `From: ${config.mailFrom}`,
    `Reply-To: ${config.mailFrom}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Date: ${new Date().toUTCString()}`,
  ];
  const escaped = body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return `${headers.join('\r\n')}\r\n\r\n${escaped}`;
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const session = await openSession(CONNECT_TIMEOUT_MS);
  try {
    await session.read(220);
    session.write('EHLO swathdeck');
    await session.read(250);
    session.write(`MAIL FROM:<${senderAddress()}>`);
    await session.read(250);
    session.write(`RCPT TO:<${to}>`);
    await session.read(250);
    session.write('DATA');
    await session.read(354);
    session.socket.write(`${message(to, subject, body)}\r\n.\r\n`);
    await session.read(250);
    session.write('QUIT');
  } finally {
    session.end();
  }
}

export async function probeMail(): Promise<boolean> {
  try {
    const session = await openSession(2500);
    try {
      await session.read(220);
      session.write('QUIT');
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
