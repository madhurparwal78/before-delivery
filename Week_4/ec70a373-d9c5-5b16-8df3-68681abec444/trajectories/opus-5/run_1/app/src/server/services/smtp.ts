import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.smtp.mailFrom);
  return match === null ? config.smtp.mailFrom.trim() : (match[1] as string);
}

/** Header values never carry stored text, so a stray newline cannot add a header. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function buildMessage(mail: OutgoingMail, sentAt: Date): string {
  const headers = [
    `From: ${headerValue(config.smtp.mailFrom)}`,
    `To: ${headerValue(mail.to)}`,
    `Subject: ${headerValue(mail.subject)}`,
    `Date: ${sentAt.toUTCString()}`,
    `Message-ID: <${randomUUID()}@pilotlight.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = mail.body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

interface SmtpSession {
  write(command: string): Promise<string>;
  end(): void;
}

function openSession(): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    let buffer = '';
    let pending: ((reply: string) => void) | null = null;
    let failed: ((error: Error) => void) | null = null;

    const fail = (error: Error): void => {
      if (failed !== null) {
        const notify = failed;
        pending = null;
        failed = null;
        notify(error);
      }
      socket.destroy();
      reject(error);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines.filter((line) => line.length > 0).pop();
      if (last === undefined || /^\d{3}-/.test(last)) return;
      const reply = buffer;
      buffer = '';
      if (pending !== null) {
        const notify = pending;
        pending = null;
        failed = null;
        notify(reply);
      } else {
        resolve({
          write(command: string): Promise<string> {
            return new Promise<string>((resolveWrite, rejectWrite) => {
              pending = resolveWrite;
              failed = rejectWrite;
              socket.write(command);
            });
          },
          end(): void {
            socket.destroy();
          },
        });
      }
    });
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('close', () => {
      if (pending !== null) fail(new Error('smtp closed'));
    });
  });
}

function expect(reply: string, prefix: string): void {
  if (!reply.trimStart().startsWith(prefix)) {
    throw new Error(`smtp refused: ${reply.slice(0, 40)}`);
  }
}

/** Delivers one message. Throws when SMTP is unreachable, so the outbox retries. */
export async function deliver(mail: OutgoingMail): Promise<void> {
  const session = await openSession();
  try {
    expect(await session.write('EHLO pilotlight\r\n'), '250');
    expect(await session.write(`MAIL FROM:<${senderAddress()}>\r\n`), '250');
    expect(await session.write(`RCPT TO:<${mail.to}>\r\n`), '250');
    expect(await session.write('DATA\r\n'), '354');
    expect(await session.write(`${buildMessage(mail, new Date())}.\r\n`), '250');
    await session.write('QUIT\r\n').catch(() => '221');
  } finally {
    session.end();
  }
}
