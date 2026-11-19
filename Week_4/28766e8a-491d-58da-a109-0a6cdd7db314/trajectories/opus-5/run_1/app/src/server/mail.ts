import { createConnection } from 'node:net';
import { hasControlCharacters } from '../shared/validate.js';
import { config } from './env.js';

export interface Message {
  to: string;
  subject: string;
  body: string;
}

const SEND_TIMEOUT_MS = 5000;

function headerSafe(value: string, field: string): string {
  if (hasControlCharacters(value)) {
    throw new Error(`Refusing to build the ${field} header from a value with control characters`);
  }
  return value;
}

/** A single-line subject: plain when it is ASCII, RFC 2047 encoded otherwise. */
function encodeSubject(subject: string): string {
  const safe = headerSafe(subject, 'Subject');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

function wrap(value: string): string {
  return value.replace(/(.{1,76})/g, '$1\r\n');
}

/**
 * Speaks SMTP to the mail catcher directly. Each send opens a fresh connection, so a
 * resend works as soon as mail is back with no restart.
 */
export async function sendMail(message: Message): Promise<void> {
  const to = headerSafe(message.to, 'To');
  const from = headerSafe(config.mail.from, 'From');
  const data = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(message.body, 'utf8').toString('base64')).trimEnd(),
  ].join('\r\n');

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    const steps = [
      `EHLO linewell`,
      `MAIL FROM:<${addressOf(from)}>`,
      `RCPT TO:<${to}>`,
      'DATA',
      `${data}\r\n.`,
      'QUIT',
    ];
    let step = -1;
    let buffer = '';
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(SEND_TIMEOUT_MS, () => fail(new Error('The mail server timed out')));
    socket.on('error', fail);
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      if (step >= steps.length) resolve();
      else reject(new Error('The mail server closed the connection early'));
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let line = buffer.indexOf('\r\n');
      while (line >= 0) {
        const reply = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        // Skip continuation lines of a multi-line reply.
        if (reply[3] !== '-') {
          const code = Number(reply.slice(0, 3));
          if (code >= 400) {
            fail(new Error(`The mail server refused the message: ${reply}`));
            return;
          }
          step += 1;
          const next = steps[step];
          if (next === undefined) {
            if (!settled) {
              settled = true;
              socket.end();
              resolve();
            }
            return;
          }
          socket.write(`${next}\r\n`);
        }
        line = buffer.indexOf('\r\n');
      }
    });
  });
}
