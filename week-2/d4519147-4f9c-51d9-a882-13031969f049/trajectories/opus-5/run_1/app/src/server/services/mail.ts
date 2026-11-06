import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

export class MailUnavailable extends Error {}

interface Conversation {
  socket: Socket;
  read(expected: number): Promise<string>;
  send(line: string): void;
}

function open(timeoutMs: number): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiting: { expected: number; resolve: (value: string) => void; reject: (error: Error) => void } | null = null;

    const settleWaiting = (): void => {
      if (!waiting) return;
      const match = /^(\d{3})(?: |-)/m.exec(buffer);
      if (!match) return;
      const lines = buffer.split(/\r?\n/);
      const final = lines.find((line) => /^\d{3} /.test(line));
      if (!final) return;
      const code = Number.parseInt(final.slice(0, 3), 10);
      const text = buffer;
      buffer = '';
      const current = waiting;
      waiting = null;
      if (code !== current.expected) current.reject(new MailUnavailable(`smtp expected ${current.expected}`));
      else current.resolve(text);
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      settleWaiting();
    });
    socket.on('error', (error) => {
      if (waiting) {
        waiting.reject(new MailUnavailable(error.message));
        waiting = null;
      }
      reject(new MailUnavailable(error.message));
    });
    socket.on('timeout', () => {
      socket.destroy();
      if (waiting) {
        waiting.reject(new MailUnavailable('smtp timeout'));
        waiting = null;
      }
      reject(new MailUnavailable('smtp timeout'));
    });
    socket.on('connect', () => {
      resolve({
        socket,
        read: (expected) =>
          new Promise<string>((resolveRead, rejectRead) => {
            waiting = { expected, resolve: resolveRead, reject: rejectRead };
            settleWaiting();
          }),
        send: (line) => socket.write(`${line}\r\n`),
      });
    });
  });
}

/** Quoted-printable, as every message declares. */
export function quotedPrintable(text: string): string {
  const bytes = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8');
  const out: string[] = [];
  let lineLength = 0;
  const pushToken = (token: string): void => {
    if (lineLength + token.length > 75) {
      out.push('=\r\n');
      lineLength = 0;
    }
    out.push(token);
    lineLength += token.length;
  };
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    if (byte === 0x0d && bytes[i + 1] === 0x0a) {
      out.push('\r\n');
      lineLength = 0;
      i += 1;
      continue;
    }
    if (byte === 0x3d || byte < 0x20 || byte > 0x7e) {
      pushToken(`=${byte.toString(16).toUpperCase().padStart(2, '0')}`);
    } else {
      pushToken(String.fromCharCode(byte));
    }
  }
  return out.join('');
}

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
}

const FROM_ADDRESS = /<([^>]+)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from;

function render(message: OutboundMessage): string {
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Message-ID: <${randomUUID()}@scopewright.test>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${quotedPrintable(message.body)}`;
}

export async function sendMail(message: OutboundMessage): Promise<void> {
  const conversation = await open(5000);
  try {
    await conversation.read(220);
    conversation.send('EHLO scopewright');
    await conversation.read(250);
    conversation.send(`MAIL FROM:<${FROM_ADDRESS}>`);
    await conversation.read(250);
    conversation.send(`RCPT TO:<${message.to}>`);
    await conversation.read(250);
    conversation.send('DATA');
    await conversation.read(354);
    const data = render(message).replace(/\r\n\./g, '\r\n..');
    conversation.socket.write(`${data}\r\n.\r\n`);
    await conversation.read(250);
    conversation.send('QUIT');
  } finally {
    conversation.socket.destroy();
  }
}

export async function mailIsUp(): Promise<boolean> {
  try {
    const conversation = await open(2500);
    try {
      await conversation.read(220);
      conversation.send('QUIT');
      return true;
    } finally {
      conversation.socket.destroy();
    }
  } catch {
    return false;
  }
}
