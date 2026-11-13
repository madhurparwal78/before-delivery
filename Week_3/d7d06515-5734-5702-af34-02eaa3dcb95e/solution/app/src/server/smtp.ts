// A minimal SMTP client: one message per connection, accepted only when the server answers 250 after DATA.
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { config } from './config.ts';

const CONNECT_MS = 3000;
const TOTAL_MS = 10000;

interface Conversation {
  expect(codes: readonly number[], command?: string): Promise<void>;
  end(): void;
}

function open(): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    const connectTimer = setTimeout(() => socket.destroy(new Error('connect timeout')), CONNECT_MS);
    const totalTimer = setTimeout(() => socket.destroy(new Error('timeout')), TOTAL_MS);
    const replies: number[] = [];
    const waiting: { resolve: (code: number) => void; reject: (error: Error) => void }[] = [];
    let buffer = '';
    let failure: Error | null = null;

    const settle = (): void => {
      while (waiting.length > 0 && replies.length > 0) waiting.shift()?.resolve(replies.shift() ?? 0);
      while (waiting.length > 0 && failure) waiting.shift()?.reject(failure);
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let cut = buffer.indexOf('\r\n'); cut >= 0; cut = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const found = /^(\d{3})([ -])/.exec(line);
        if (found && found[2] === ' ') replies.push(Number(found[1]));
      }
      settle();
    });
    const fail = (error: Error): void => {
      failure = error;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      settle();
      reject(error);
    };
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('closed')));
    socket.on('connect', () => {
      clearTimeout(connectTimer);
      const next = (): Promise<number> => new Promise((ok, no) => {
        waiting.push({ resolve: ok, reject: no });
        settle();
      });
      resolve({
        async expect(codes, command) {
          if (command !== undefined) socket.write(`${command}\r\n`);
          const code = await next();
          if (!codes.includes(code)) throw new Error(`unexpected reply ${code}`);
        },
        end() {
          clearTimeout(totalTimer);
          socket.destroy();
        },
      });
    });
  });
}

const addressPart = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
const clean = (value: string): string => value.replace(/[\r\n]+/g, ' ');

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words: string[] = [];
  let current = '';
  for (const character of subject) {
    if (Buffer.byteLength(current + character) > 45) {
      words.push(current);
      current = '';
    }
    current += character;
  }
  words.push(current);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString('base64')}?=`).join('\r\n ');
}

function message(to: string, subject: string, text: string): string {
  const ascii = /^[\x00-\x7f]*$/.test(text);
  const domain = addressPart(config.smtp.from).split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${clean(config.smtp.from)}`,
    `To: ${clean(to)}`,
    `Subject: ${encodeSubject(clean(subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    `Content-Transfer-Encoding: ${ascii ? '7bit' : '8bit'}`,
  ];
  const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n.`;
}

async function greet(conversation: Conversation): Promise<void> {
  await conversation.expect([220]);
  await conversation.expect([250], `EHLO ${new URL(config.publicUrl).hostname}`);
}

/** True only when the server accepted the message (its 250 after DATA); never throws. */
export async function sendMail(mail: { to: string; subject: string; text: string }): Promise<boolean> {
  let conversation: Conversation | undefined;
  try {
    conversation = await open();
    await greet(conversation);
    await conversation.expect([250], `MAIL FROM:<${addressPart(config.smtp.from)}>`);
    await conversation.expect([250, 251], `RCPT TO:<${clean(mail.to)}>`);
    await conversation.expect([354], 'DATA');
    await conversation.expect([250], message(mail.to, mail.subject, mail.text));
    return true;
  } catch {
    return false;
  } finally {
    conversation?.end();
  }
}

/** Resolves when the server greets and answers EHLO. Throws otherwise. */
export async function checkSmtp(): Promise<void> {
  const conversation = await open();
  try {
    await greet(conversation);
  } finally {
    conversation.end();
  }
}
