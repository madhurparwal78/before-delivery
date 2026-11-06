/** Plain SMTP delivery to the configured mail sink. */
import { createConnection } from 'node:net';
import { config } from '../config.js';

export class MailUnavailable extends Error {}

type Session = {
  send: (line: string) => Promise<string>;
  close: () => void;
};

function connect(): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(10000);
    let buffer = '';
    let pending: ((reply: string) => void) | null = null;

    const fail = (): void => {
      socket.destroy();
      reject(new MailUnavailable());
    };
    socket.on('error', fail);
    socket.on('timeout', fail);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines.filter((line) => line.length > 0).at(-1);
      if (last && /^\d{3} /.test(last) && buffer.endsWith('\r\n')) {
        const reply = buffer;
        buffer = '';
        const resolver = pending;
        pending = null;
        if (resolver) resolver(reply);
        else resolve({ send, close });
      }
    });

    function send(line: string): Promise<string> {
      return new Promise((resolveSend, rejectSend) => {
        pending = (reply) => {
          const code = Number.parseInt(reply.slice(0, 3), 10);
          if (code >= 400) rejectSend(new MailUnavailable());
          else resolveSend(reply);
        };
        socket.write(`${line}\r\n`, 'utf8', (error) => {
          if (error) rejectSend(new MailUnavailable());
        });
      });
    }

    function close(): void {
      socket.destroy();
    }
  });
}

/** RFC 2047 encoded-word for a subject holding any non-ASCII character. */
function encodeSubject(subject: string): string {
  if (!/[^\x20-\x7e]/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match?.[1] ?? config.mail.from;
}

function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const session = await connect();
  try {
    await session.send('EHLO lineboard');
    await session.send(`MAIL FROM:<${fromAddress()}>`);
    await session.send(`RCPT TO:<${to}>`);
    await session.send('DATA');
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${to}`,
      `Subject: ${encodeSubject(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    await session.send(`${headers}\r\n\r\n${dotStuff(body)}\r\n.`);
    await session.send('QUIT').catch(() => undefined);
  } finally {
    session.close();
  }
}
