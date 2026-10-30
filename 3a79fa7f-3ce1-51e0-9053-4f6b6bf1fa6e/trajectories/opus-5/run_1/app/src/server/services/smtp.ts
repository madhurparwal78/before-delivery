import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

interface SmtpSession {
  socket: Socket;
  read(): Promise<string>;
}

function openSession(host: string, port: number, timeoutMs: number): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiting: ((value: string) => void) | null = null;

    const flush = (): void => {
      if (!waiting) return;
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buffer);
      if (!match) return;
      const reply = match[0];
      buffer = buffer.slice(reply.length);
      const resolveWaiting = waiting;
      waiting = null;
      resolveWaiting(reply);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      flush();
    });
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP timeout'));
    });
    socket.on('connect', () =>
      resolve({
        socket,
        read: () =>
          new Promise<string>((res, rej) => {
            waiting = res;
            socket.once('error', rej);
            flush();
          }),
      }),
    );
  });
}

function envelopeAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled?.[1] ?? from.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function wrapBase64(value: string): string {
  return (value.match(/.{1,76}/g) ?? []).join('\r\n');
}

export interface OutgoingNotice {
  to: string;
  subject: string;
  body: string;
}

export async function sendMail(notice: OutgoingNotice): Promise<void> {
  const session = await openSession(config.smtpHost, config.smtpPort, 10000);
  const { socket } = session;

  const send = async (line: string, expect: string): Promise<void> => {
    socket.write(`${line}\r\n`);
    const reply = await session.read();
    if (!reply.startsWith(expect)) throw new Error(`SMTP refused: ${reply.slice(0, 3)}`);
  };

  try {
    const greeting = await session.read();
    if (!greeting.startsWith('220')) throw new Error('SMTP greeting failed');
    await send('EHLO ternfoils.com', '250');
    await send(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, '250');
    await send(`RCPT TO:<${notice.to}>`, '250');
    await send('DATA', '354');

    const ascii = /^[\x20-\x7E\n]*$/.test(notice.body);
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${notice.to}`,
      `Subject: ${encodeHeader(notice.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      `Content-Transfer-Encoding: ${ascii ? '7bit' : 'base64'}`,
    ].join('\r\n');
    const payload = ascii ? dotStuff(notice.body) : wrapBase64(Buffer.from(notice.body, 'utf8').toString('base64'));
    socket.write(`${headers}\r\n\r\n${payload}\r\n.\r\n`);
    const accepted = await session.read();
    if (!accepted.startsWith('250')) throw new Error('SMTP rejected the message');
    socket.write('QUIT\r\n');
  } finally {
    socket.destroy();
  }
}
