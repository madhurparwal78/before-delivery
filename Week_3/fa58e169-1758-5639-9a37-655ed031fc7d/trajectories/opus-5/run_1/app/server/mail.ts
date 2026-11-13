import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config';

export const MAIL_FAILED = 'The mail could not be sent. Try again.';

function envelopeAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled ? angled[1] : from.trim();
}

interface Conversation {
  send: (line: string) => void;
  expect: (code: number) => Promise<void>;
  end: () => void;
}

function talk(host: string, port: number, timeoutMs: number): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiting: { code: number; resolve: () => void; reject: (error: Error) => void } | null = null;

    const settle = (): void => {
      if (!waiting) return;
      const lines = buffer.split('\r\n').filter((line) => line.length > 0);
      const last = lines[lines.length - 1];
      if (!last || /^\d{3}-/.test(last)) return;
      const code = Number.parseInt(last.slice(0, 3), 10);
      const pending = waiting;
      buffer = '';
      waiting = null;
      if (code === pending.code) pending.resolve();
      else pending.reject(new Error(`smtp ${code}`));
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      settle();
    });
    const fail = (error: Error): void => {
      if (waiting) {
        waiting.reject(error);
        waiting = null;
      }
      reject(error);
      socket.destroy();
    };
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('connect', () => {
      resolve({
        send: (line: string) => socket.write(`${line}\r\n`),
        expect: (code: number) =>
          new Promise<void>((ok, no) => {
            waiting = { code, resolve: ok, reject: no };
            settle();
          }),
        end: () => socket.end(),
      });
    });
  });
}

export async function sendMail(to: string, subject: string, body: string, sentAt = new Date()): Promise<void> {
  const chat = await talk(config.smtpHost, config.smtpPort, 5000);
  const from = envelopeAddress(config.mailFrom);
  await chat.expect(220);
  chat.send('EHLO twinrow');
  await chat.expect(250);
  chat.send(`MAIL FROM:<${from}>`);
  await chat.expect(250);
  chat.send(`RCPT TO:<${to}>`);
  await chat.expect(250);
  chat.send('DATA');
  await chat.expect(354);
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${sentAt.toUTCString()}`,
    `Message-ID: <${randomUUID()}@twinrow>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ].join('\r\n');
  const safeBody = body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  chat.send(`${headers}\r\n\r\n${safeBody}\r\n.`);
  await chat.expect(250);
  chat.send('QUIT');
  chat.end();
}

export function verificationMail(token: string): { subject: string; body: string } {
  return {
    subject: 'Verify your Twinrow email',
    body: `Verify your Twinrow email by opening this link:\n${config.publicUrl}/verify?token=${token}`,
  };
}

export function invitationMail(patternName: string, token: string): { subject: string; body: string } {
  return {
    subject: `Test ${patternName} on Twinrow`,
    body: `You are invited to test ${patternName} on Twinrow. Join here:\n${config.publicUrl}/invite/${token}`,
  };
}

export function noteMail(patternName: string, row: number, text: string): { subject: string; body: string } {
  return {
    subject: `Note on row ${row} of ${patternName}`,
    body: text,
  };
}
