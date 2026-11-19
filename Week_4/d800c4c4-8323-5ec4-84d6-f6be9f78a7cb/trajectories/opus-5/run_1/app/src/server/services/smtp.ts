import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { env } from '../env';

export class MailRefused extends Error {}

interface Conversation {
  readonly socket: Socket;
  read(): Promise<string>;
}

function open(): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.mail.host, port: env.mail.port });
    socket.setEncoding('utf8');
    socket.setTimeout(15000);
    let buffer = '';
    let waiting: ((line: string) => void) | null = null;
    let failure: Error | null = null;

    const settleFailure = (error: Error): void => {
      failure = error;
      socket.destroy();
      reject(error);
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      // A reply ends with a line whose fourth character is a space.
      const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buffer);
      if (match && waiting) {
        const reply = match[0];
        buffer = buffer.slice(reply.length);
        const settle = waiting;
        waiting = null;
        settle(reply);
      }
    });
    socket.on('error', settleFailure);
    socket.on('timeout', () => settleFailure(new Error('SMTP timed out')));

    const read = (): Promise<string> =>
      new Promise((resolveRead, rejectRead) => {
        if (failure) {
          rejectRead(failure);
          return;
        }
        const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buffer);
        if (match) {
          buffer = buffer.slice(match[0].length);
          resolveRead(match[0]);
          return;
        }
        waiting = resolveRead;
        socket.once('close', () => rejectRead(new Error('SMTP connection closed')));
      });

    socket.on('connect', () => resolve({ socket, read }));
  });
}

async function expect(conversation: Conversation, code: string): Promise<void> {
  const reply = await conversation.read();
  if (!reply.startsWith(code)) {
    throw new MailRefused(`SMTP expected ${code} but read ${reply.trim()}`);
  }
}

function write(conversation: Conversation, line: string): void {
  conversation.socket.write(`${line}\r\n`);
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match?.[1] ?? mailbox.trim();
}

/** Hands one message to the sink; a refusal or a dropped connection throws. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const conversation = await open();
  try {
    await expect(conversation, '220');
    write(conversation, 'EHLO pegworth.example');
    await expect(conversation, '250');
    write(conversation, `MAIL FROM:<${addressOf(env.mail.from)}>`);
    await expect(conversation, '250');
    write(conversation, `RCPT TO:<${addressOf(to)}>`);
    await expect(conversation, '250');
    write(conversation, 'DATA');
    await expect(conversation, '354');
    const headers = [
      `From: ${headerValue(env.mail.from)}`,
      `To: ${headerValue(to)}`,
      `Subject: ${headerValue(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@pegworth.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    conversation.socket.write(`${headers}\r\n\r\n${dotStuff(body)}\r\n.\r\n`);
    await expect(conversation, '250');
    write(conversation, 'QUIT');
  } finally {
    conversation.socket.destroy();
  }
}
