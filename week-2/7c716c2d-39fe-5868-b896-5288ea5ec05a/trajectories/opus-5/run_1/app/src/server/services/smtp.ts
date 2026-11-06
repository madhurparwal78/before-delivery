import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

export type Letter = {
  from: string;
  to: string;
  subject: string;
  body: string;
  headers: Record<string, string>;
  sentAt: Date;
};

const timeoutMs = 5000;

function base64Lines(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) lines.push(encoded.slice(index, index + 76));
  return lines.join('\r\n');
}

function headerValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return match?.[1] ?? value.trim();
}

function rfc2822Date(when: Date): string {
  return when.toUTCString().replace('GMT', '+0000');
}

export function letterText(letter: Letter): string {
  const lines = [
    `From: ${letter.from}`,
    `To: ${letter.to}`,
    `Subject: ${headerValue(letter.subject)}`,
    `Message-ID: <${randomUUID()}@tallyroom.test>`,
    `Date: ${rfc2822Date(letter.sentAt)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  for (const [name, value] of Object.entries(letter.headers)) lines.push(`${name}: ${headerValue(value)}`);
  return `${lines.join('\r\n')}\r\n\r\n${base64Lines(letter.body)}\r\n`;
}

type Conversation = { socket: Socket; read: () => Promise<string>; write: (line: string) => void };

async function connect(host: string, port: number): Promise<Conversation> {
  const socket = createConnection({ host, port });
  socket.setTimeout(timeoutMs);
  let buffer = '';
  let waiting: ((value: string) => void) | null = null;
  let failure: ((error: Error) => void) | null = null;

  const deliver = (): void => {
    const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buffer);
    if (match === null || waiting === null) return;
    const reply = match[0];
    buffer = buffer.slice(reply.length);
    const resolve = waiting;
    waiting = null;
    resolve(reply);
  };

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    deliver();
  });
  const fail = (error: Error): void => {
    if (failure !== null) failure(error);
    socket.destroy();
  };
  socket.on('error', fail);
  socket.on('timeout', () => fail(new Error('SMTP timed out')));
  socket.on('close', () => {
    if (waiting !== null) fail(new Error('SMTP closed'));
  });

  await new Promise<void>((resolve, reject) => {
    failure = reject;
    socket.once('connect', () => resolve());
  });

  return {
    socket,
    read: () =>
      new Promise<string>((resolve, reject) => {
        waiting = resolve;
        failure = reject;
        deliver();
      }),
    write: (line) => socket.write(line),
  };
}

function expect(reply: string, code: string): void {
  if (!reply.startsWith(code)) throw new Error(`SMTP said ${reply.trim()}`);
}

/** Hands one letter to SMTP, which has accepted it once 250 comes back. */
export async function sendLetter(host: string, port: number, letter: Letter): Promise<void> {
  const smtp = await connect(host, port);
  try {
    expect(await smtp.read(), '220');
    smtp.write('EHLO tallyroom\r\n');
    expect(await smtp.read(), '250');
    smtp.write(`MAIL FROM:<${address(letter.from)}>\r\n`);
    expect(await smtp.read(), '250');
    smtp.write(`RCPT TO:<${address(letter.to)}>\r\n`);
    expect(await smtp.read(), '250');
    smtp.write('DATA\r\n');
    expect(await smtp.read(), '354');
    smtp.write(`${letterText(letter)}.\r\n`);
    expect(await smtp.read(), '250');
    smtp.write('QUIT\r\n');
  } finally {
    smtp.socket.end();
  }
}
