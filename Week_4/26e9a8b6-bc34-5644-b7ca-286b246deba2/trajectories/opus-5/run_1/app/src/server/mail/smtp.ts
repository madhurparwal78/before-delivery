import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

const SMTP_TIMEOUT_MS = 5000;

export class MailRefused extends Error {}

export interface Message {
  to: string;
  subject: string;
  body: string;
}

interface Conversation {
  socket: Socket;
  read: (expected: number) => Promise<string>;
  write: (line: string) => void;
}

function converse(socket: Socket): Conversation {
  let buffered = '';
  const waiting: { expected: number; resolve: (reply: string) => void; reject: (error: Error) => void }[] = [];

  const drain = (): void => {
    for (;;) {
      const pending = waiting[0];
      if (!pending) return;
      const match = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\r?\n/.exec(buffered);
      if (!match) return;
      const reply = buffered.slice(0, match[0].length);
      buffered = buffered.slice(match[0].length);
      waiting.shift();
      if (Number(match[1]) !== pending.expected) {
        pending.reject(new MailRefused(`SMTP replied ${reply.trim()}`));
      } else {
        pending.resolve(reply);
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    drain();
  });
  socket.on('error', (error: Error) => {
    while (waiting.length > 0) waiting.shift()?.reject(new MailRefused(error.message));
  });
  socket.on('close', () => {
    while (waiting.length > 0) waiting.shift()?.reject(new MailRefused('connection closed'));
  });

  return {
    socket,
    read: (expected) =>
      new Promise<string>((resolve, reject) => {
        waiting.push({ expected, resolve, reject });
        drain();
      }),
    write: (line) => socket.write(`${line}\r\n`),
  };
}

function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function senderAddress(mailFrom: string): string {
  const angled = /<([^>]+)>/.exec(mailFrom);
  return angled?.[1] ?? mailFrom;
}

function encodeHeaderWord(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** Hands the message to the SMTP server; resolves only once it has accepted. */
export async function sendMail(message: Message): Promise<void> {
  const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(SMTP_TIMEOUT_MS);
  const talk = converse(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('timeout', () => reject(new MailRefused('connect timeout')));
      socket.once('error', (error: Error) => reject(new MailRefused(error.message)));
    });
    await talk.read(220);
    talk.write('EHLO pennywasher');
    await talk.read(250);
    talk.write(`MAIL FROM:<${senderAddress(config.smtp.mailFrom)}>`);
    await talk.read(250);
    talk.write(`RCPT TO:<${message.to}>`);
    await talk.read(250);
    talk.write('DATA');
    await talk.read(354);
    const headers = [
      `From: ${config.smtp.mailFrom}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeaderWord(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    socket.write(`${headers}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    await talk.read(250);
    talk.write('QUIT');
  } finally {
    socket.destroy();
  }
}
