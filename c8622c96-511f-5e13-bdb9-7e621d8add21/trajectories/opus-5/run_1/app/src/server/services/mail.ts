import { createConnection } from 'node:net';
import { config } from '../config.js';

export class MailUnreachable extends Error {
  constructor(detail: string) {
    super(`mail server unreachable: ${detail}`);
    this.name = 'MailUnreachable';
  }
}

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

function encodedWords(subject: string): string {
  const characters = [...subject];
  const words: string[] = [];
  let current: string[] = [];
  const budget = 70 - '=?UTF-8?B??='.length;
  const encodedLength = (chars: string[]): number =>
    Math.ceil(Buffer.byteLength(chars.join(''), 'utf8') / 3) * 4;
  for (const character of characters) {
    const next = [...current, character];
    if (encodedLength(next) > budget && current.length > 0) {
      words.push(`=?UTF-8?B?${Buffer.from(current.join(''), 'utf8').toString('base64')}?=`);
      current = [character];
      continue;
    }
    current = next;
  }
  if (current.length > 0) {
    words.push(`=?UTF-8?B?${Buffer.from(current.join(''), 'utf8').toString('base64')}?=`);
  }
  return words.join('\r\n ');
}

/** Plain text when the subject is printable ASCII without `=?`, otherwise MIME encoded-words. */
export function subjectHeader(subject: string): string {
  if (PRINTABLE_ASCII.test(subject) && !subject.includes('=?')) {
    return `Subject: ${subject}`;
  }
  return `Subject: ${encodedWords(subject)}`;
}

function messageText(to: string, subject: string, body: string): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    subjectHeader(subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
  ];
  const dotStuffed = body.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
  return `${headers.join('\r\n')}\r\n\r\n${dotStuffed}\r\n`;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match ? (match[1] as string) : config.mail.from;
}

interface SmtpSession {
  send(line: string, expect: number): Promise<string>;
  close(): void;
}

function openSession(timeoutMs: number): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let pending: { expect: number; resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;
    const fail = (detail: string): void => {
      const error = new MailUnreachable(detail);
      socket.destroy();
      if (pending) {
        pending.reject(error);
        pending = null;
      } else {
        reject(error);
      }
    };
    socket.on('error', (error) => fail(error.message));
    socket.on('timeout', () => fail('timeout'));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const complete = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buffer);
      if (!complete) return;
      const reply = buffer;
      const code = Number(complete[2]);
      buffer = '';
      if (!pending) {
        if (code === 220) {
          resolve({
            send(line, expect) {
              return new Promise<string>((resolveLine, rejectLine) => {
                pending = { expect, resolve: resolveLine, reject: rejectLine };
                socket.write(line);
              });
            },
            close() {
              socket.destroy();
            },
          });
          return;
        }
        fail(`greeting ${code}`);
        return;
      }
      const waiting = pending;
      pending = null;
      if (code !== waiting.expect) {
        socket.destroy();
        waiting.reject(new MailUnreachable(`unexpected reply ${reply.trim()}`));
        return;
      }
      waiting.resolve(reply);
    });
  });
}

/** Writes one message with exactly one recipient to the SMTP sink. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const session = await openSession(5000);
  try {
    await session.send('EHLO saltprint-desk\r\n', 250);
    await session.send(`MAIL FROM:<${senderAddress()}>\r\n`, 250);
    await session.send(`RCPT TO:<${to}>\r\n`, 250);
    await session.send('DATA\r\n', 354);
    await session.send(`${messageText(to, subject, body)}.\r\n`, 250);
    await session.send('QUIT\r\n', 221);
  } finally {
    session.close();
  }
}
