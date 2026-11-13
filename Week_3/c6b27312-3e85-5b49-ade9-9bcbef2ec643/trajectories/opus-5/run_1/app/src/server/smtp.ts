import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';

export class SmtpError extends Error {}

type Session = {
  send: (line: string) => Promise<string>;
  end: () => void;
};

function open(host: string, port: number, timeoutMs: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiting: ((reply: string) => void) | null = null;

    const settle = (): void => {
      if (!waiting) return;
      const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\r?\n/.exec(buffer);
      if (!match) return;
      const reply = buffer.slice(0, match[0].length);
      buffer = buffer.slice(match[0].length);
      const resolveWaiting = waiting;
      waiting = null;
      resolveWaiting(reply);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      settle();
    });
    socket.on('error', (error) => reject(new SmtpError(error.message)));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new SmtpError('timeout'));
    });

    const expect = (): Promise<string> =>
      new Promise((resolveReply, rejectReply) => {
        const timer = setTimeout(() => rejectReply(new SmtpError('timeout')), timeoutMs);
        waiting = (reply) => {
          clearTimeout(timer);
          resolveReply(reply);
        };
        settle();
      });

    socket.on('connect', () => {
      void expect().then((greeting) => {
        if (!greeting.startsWith('220')) {
          socket.destroy();
          reject(new SmtpError(greeting));
          return;
        }
        resolve({
          send: async (line) => {
            socket.write(line);
            return expect();
          },
          end: () => socket.destroy(),
        });
      }, reject);
    });
  });
}

/** Encodes a header value that may hold characters outside ASCII. */
function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

export async function sendMail(options: {
  host: string;
  port: number;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const session = await open(options.host, options.port, 5000);
  const expectOk = (reply: string): void => {
    if (!/^(2|3)\d\d/.test(reply)) throw new SmtpError(reply);
  };
  try {
    expectOk(await session.send('EHLO tinework\r\n'));
    expectOk(await session.send(`MAIL FROM:<${addressOf(options.from)}>\r\n`));
    expectOk(await session.send(`RCPT TO:<${addressOf(options.to)}>\r\n`));
    expectOk(await session.send('DATA\r\n'));
    const headers = [
      `From: ${headerValue(options.from)}`,
      `To: ${options.to}`,
      `Subject: ${headerValue(options.subject)}`,
      `Message-ID: <${randomUUID()}@tinework>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n');
    const body = Buffer.from(options.text, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');
    expectOk(await session.send(`${headers}\r\n\r\n${body}\r\n.\r\n`));
    await session.send('QUIT\r\n').catch(() => '');
  } finally {
    session.end();
  }
}
