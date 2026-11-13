import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

class MailUnavailable extends Error {}

interface Session {
  socket: Socket;
  read(): Promise<string>;
}

function open(timeoutMs: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiting: ((line: string) => void) | null = null;

    const flush = (): void => {
      if (!waiting) return;
      const index = buffer.indexOf('\r\n');
      if (index < 0) return;
      /** A reply is complete when its last line has a space after the code. */
      const lines = buffer.split('\r\n');
      let end = -1;
      for (const [position, line] of lines.entries()) {
        if (/^\d{3} /.test(line)) {
          end = position;
          break;
        }
      }
      if (end < 0) return;
      const reply = lines.slice(0, end + 1).join('\r\n');
      buffer = lines.slice(end + 1).join('\r\n');
      const resolveWaiting = waiting;
      waiting = null;
      resolveWaiting(reply);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      flush();
    });
    socket.on('error', (error) => reject(new MailUnavailable(error.message)));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new MailUnavailable('smtp timed out'));
    });
    socket.on('connect', () =>
      resolve({
        socket,
        read: () =>
          new Promise<string>((resolveLine, rejectLine) => {
            waiting = resolveLine;
            socket.once('error', rejectLine);
            flush();
          }),
      }),
    );
  });
}

function expect(reply: string, code: string): void {
  if (!reply.startsWith(code)) throw new MailUnavailable(`smtp said ${reply.slice(0, 64)}`);
}

async function command(session: Session, line: string, code: string): Promise<void> {
  session.socket.write(`${line}\r\n`);
  expect(await session.read(), code);
}

function addressOf(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1] ?? from;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const session = await open(8000);
  try {
    expect(await session.read(), '220');
    await command(session, `EHLO candour-bench`, '250');
    await command(session, `MAIL FROM:<${addressOf(config.mailFrom)}>`, '250');
    await command(session, `RCPT TO:<${to}>`, '250');
    await command(session, 'DATA', '354');
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');
    session.socket.write(`${headers}\r\n\r\n${dotStuff(body)}\r\n.\r\n`);
    expect(await session.read(), '250');
    await command(session, 'QUIT', '221');
  } finally {
    session.socket.destroy();
  }
}

export async function isAvailable(): Promise<boolean> {
  try {
    const session = await open(3000);
    try {
      expect(await session.read(), '220');
      await command(session, 'QUIT', '221');
      return true;
    } finally {
      session.socket.destroy();
    }
  } catch {
    return false;
  }
}
