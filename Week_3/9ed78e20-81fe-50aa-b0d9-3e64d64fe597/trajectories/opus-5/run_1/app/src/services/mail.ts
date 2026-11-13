import net from 'node:net';
import { config } from '../config.js';

const MAIL_TIMEOUT_MS = 5000;

export class MailUnreachable extends Error {}
export class MailRefused extends Error {}

export type Recipient = { readonly name: string; readonly email: string };

export type OutgoingMessage = {
  readonly to: Recipient;
  readonly subject: string;
  readonly text: string;
  readonly messageId: string;
};

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;
const NEEDS_QUOTING = /[()<>@,;:\\".[\]]/;

function encodedWords(value: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character, 'utf8') > 30) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk !== '') {
    words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
  }
  return words.join(' ');
}

export function encodeHeaderText(value: string): string {
  return ASCII_PRINTABLE.test(value) ? value : encodedWords(value);
}

export function formatAddress(recipient: Recipient): string {
  const name = recipient.name;
  if (name === '') return `<${recipient.email}>`;
  if (!ASCII_PRINTABLE.test(name)) return `${encodedWords(name)} <${recipient.email}>`;
  if (NEEDS_QUOTING.test(name)) {
    return `"${name.replace(/([\\"])/g, '\\$1')}" <${recipient.email}>`;
  }
  return `${name} <${recipient.email}>`;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match === null ? config.mail.from.trim() : (match[1] as string).trim();
}

export function buildMessage(message: OutgoingMessage): string {
  const body = Buffer.from(message.text, 'utf8').toString('base64');
  const wrapped = body.replace(/(.{1,76})/g, '$1\r\n').trimEnd();
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${formatAddress(message.to)}`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrapped}\r\n`;
}

type Session = {
  readonly send: (line: string) => Promise<string>;
  readonly end: () => void;
};

async function openSession(): Promise<Session> {
  const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(MAIL_TIMEOUT_MS);
  let buffer = '';
  let waiting: ((reply: string) => void) | null = null;
  let failure: Error | null = null;
  let rejectWaiting: ((error: Error) => void) | null = null;

  const fail = (error: Error): void => {
    failure = error;
    if (rejectWaiting !== null) {
      const reject = rejectWaiting;
      waiting = null;
      rejectWaiting = null;
      reject(error);
    }
  };

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const complete = /(^|\n)(\d{3}) [^\n]*\r?\n$/.test(buffer);
    if (complete && waiting !== null) {
      const resolve = waiting;
      const reply = buffer;
      buffer = '';
      waiting = null;
      rejectWaiting = null;
      resolve(reply);
    }
  });
  socket.on('error', (error) => fail(new MailUnreachable(`mail_unreachable: ${error.message}`)));
  socket.on('timeout', () => {
    socket.destroy();
    fail(new MailUnreachable('mail_unreachable: timeout'));
  });
  socket.on('close', () => fail(new MailUnreachable('mail_unreachable: closed')));

  const read = (): Promise<string> =>
    new Promise((resolve, reject) => {
      if (failure !== null) {
        reject(failure);
        return;
      }
      const complete = /(^|\n)(\d{3}) [^\n]*\r?\n$/.test(buffer);
      if (complete) {
        const reply = buffer;
        buffer = '';
        resolve(reply);
        return;
      }
      waiting = resolve;
      rejectWaiting = reject;
    });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', (error) =>
      reject(new MailUnreachable(`mail_unreachable: ${error.message}`)),
    );
  });

  const greeting = await read();
  if (!greeting.startsWith('220')) {
    socket.destroy();
    throw new MailUnreachable(`mail_unreachable: greeting ${greeting.slice(0, 3)}`);
  }

  return {
    send: async (line: string): Promise<string> => {
      socket.write(line.endsWith('\r\n') ? line : `${line}\r\n`);
      return read();
    },
    end: (): void => {
      socket.destroy();
    },
  };
}

function expect(reply: string, codes: readonly string[]): void {
  const lines = reply.trim().split(/\r?\n/);
  const status = (lines[lines.length - 1] ?? '').slice(0, 3);
  if (codes.includes(status)) return;
  if (status.startsWith('5')) throw new MailRefused(`mail_refused: ${status}`);
  throw new MailUnreachable(`mail_unreachable: ${status}`);
}

export async function sendMail(message: OutgoingMessage): Promise<void> {
  const session = await openSession();
  try {
    expect(await session.send('EHLO aldermoor.example'), ['250']);
    expect(await session.send(`MAIL FROM:<${senderAddress()}>`), ['250']);
    expect(await session.send(`RCPT TO:<${message.to.email}>`), ['250', '251']);
    expect(await session.send('DATA'), ['354']);
    const payload = buildMessage(message)
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    expect(await session.send(`${payload}\r\n.`), ['250']);
    await session.send('QUIT').catch(() => undefined);
  } finally {
    session.end();
  }
}

export async function probeMail(): Promise<boolean> {
  try {
    const session = await openSession();
    try {
      expect(await session.send('EHLO aldermoor.example'), ['250']);
      await session.send('QUIT').catch(() => undefined);
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
