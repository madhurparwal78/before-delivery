import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';

/** Plain SMTP delivery to the mail service. Every email is from MAIL_FROM. */

export class MailUnavailable extends Error {}

export interface Email {
  to: string;
  subject: string;
  body: string;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(email: Email): string {
  const body = Buffer.from(email.body, 'utf8').toString('base64');
  const wrapped = body.replace(/(.{1,76})/g, '$1\r\n');
  return [
    `From: ${encodeHeader(env.mailFrom)}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Message-ID: <${randomUUID()}@spindrift.test>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
  ].join('\r\n');
}

interface Session {
  socket: net.Socket;
  read: () => Promise<string>;
}

function openSession(timeoutMs: number): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    const socket = net.createConnection({ host: env.smtpHost, port: env.smtpPort });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    const waiters: ((line: string) => void)[] = [];

    const flush = (): void => {
      // An SMTP reply ends with a line whose fourth character is a space.
      const lines = buffer.split('\r\n');
      for (let i = 0; i < lines.length - 1; i += 1) {
        const line = lines[i] ?? '';
        if (line.length >= 4 && line[3] === '-') continue;
        const consumed = lines.slice(0, i + 1).join('\r\n');
        buffer = buffer.slice(consumed.length + 2);
        const waiter = waiters.shift();
        if (waiter) waiter(consumed);
        flush();
        return;
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      flush();
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new MailUnavailable('timeout'));
    });
    socket.on('error', (error) => reject(new MailUnavailable(String(error))));
    socket.on('connect', () =>
      resolve({
        socket,
        read: () =>
          new Promise<string>((resolveLine, rejectLine) => {
            waiters.push(resolveLine);
            socket.once('error', rejectLine);
            flush();
          }),
      }),
    );
  });
}

/** Send one email, failing loudly so the job that owns it can wait and retry. */
export async function sendEmail(email: Email, timeoutMs = 10_000): Promise<void> {
  const session = await openSession(timeoutMs);
  const { socket, read } = session;
  const say = async (command: string, expect: number): Promise<void> => {
    socket.write(`${command}\r\n`);
    const reply = await read();
    const code = Number.parseInt(reply.slice(0, 3), 10);
    if (code !== expect) throw new MailUnavailable(`${command.split(' ')[0]}: ${reply.trim()}`);
  };
  try {
    const greeting = await read();
    if (!greeting.startsWith('220')) throw new MailUnavailable(`greeting ${greeting.trim()}`);
    await say(`EHLO spindrift-rooms`, 250);
    await say(`MAIL FROM:<${addressOf(env.mailFrom)}>`, 250);
    await say(`RCPT TO:<${email.to}>`, 250);
    await say('DATA', 354);
    socket.write(`${buildMessage(email)}\r\n.\r\n`);
    const stored = await read();
    if (!stored.startsWith('250')) throw new MailUnavailable(`data ${stored.trim()}`);
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
    socket.destroy();
  }
}

export async function mailIsUp(): Promise<boolean> {
  try {
    const { socket, read } = await openSession(3_000);
    const greeting = await read();
    socket.write('QUIT\r\n');
    socket.end();
    socket.destroy();
    return greeting.startsWith('220');
  } catch {
    return false;
  }
}
