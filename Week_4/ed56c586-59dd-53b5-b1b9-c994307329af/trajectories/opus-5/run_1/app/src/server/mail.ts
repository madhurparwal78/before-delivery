/**
 * The outgoing mail client: a plain SMTP conversation over a socket, with no
 * authentication. Each send connects again, so a failed connection is never
 * cached and the next press sends once mail is back.
 */

import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { MailConfig } from './config.js';

export class MailUnavailableError extends Error {
  constructor(reason: string) {
    super(`The mail server is unavailable: ${reason}`);
    this.name = 'MailUnavailableError';
  }
}

export interface Envelope {
  readonly to: string;
  readonly from: string;
  readonly replyTo: string;
  readonly subject: string;
  readonly body: string;
}

const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);

/** RFC 2047 encoded words, so an inbox shows the original characters. */
const encodeHeaderValue = (value: string): string => {
  if (isAscii(value)) return value;
  const words: string[] = [];
  let chunk = Buffer.alloc(0);
  for (const char of value) {
    const bytes = Buffer.from(char, 'utf8');
    if (chunk.length + bytes.length > 36) {
      words.push(`=?UTF-8?B?${chunk.toString('base64')}?=`);
      chunk = Buffer.alloc(0);
    }
    chunk = Buffer.concat([chunk, bytes]);
  }
  words.push(`=?UTF-8?B?${chunk.toString('base64')}?=`);
  return words.join('\r\n ');
};

const addressOf = (mailbox: string): string => {
  const angled = /<([^>]+)>/.exec(mailbox);
  return angled?.[1] ?? mailbox.trim();
};

const base64Lines = (text: string): string =>
  (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? ['']).join('\r\n');

const buildMessage = (envelope: Envelope): string => {
  const headers = [
    `From: ${encodeHeaderValue(envelope.from)}`,
    `To: ${envelope.to}`,
    `Reply-To: ${envelope.replyTo}`,
    `Subject: ${encodeHeaderValue(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@ottolinerask.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${base64Lines(envelope.body)}\r\n`;
};

interface Conversation {
  readonly socket: Socket;
  expect(codes: readonly number[], command?: string): Promise<void>;
}

const openConversation = (socket: Socket): Conversation => {
  let buffered = '';
  const waiting: ((lines: string) => void)[] = [];

  const drain = (): void => {
    // A reply ends with a line whose fourth character is a space.
    for (;;) {
      const match = /^(?:\d{3}-[^\r\n]*\r?\n)*\d{3} [^\r\n]*\r?\n/.exec(buffered);
      if (match === null) return;
      const reply = match[0];
      buffered = buffered.slice(reply.length);
      const resolve = waiting.shift();
      if (resolve === undefined) return;
      resolve(reply);
    }
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    drain();
  });

  const read = (): Promise<string> =>
    new Promise((resolve) => {
      waiting.push(resolve);
      drain();
    });

  return {
    socket,
    async expect(codes, command) {
      if (command !== undefined) socket.write(`${command}\r\n`);
      const reply = await read();
      const lastLine = reply.trimEnd().split(/\r?\n/).at(-1) ?? '';
      if (!codes.includes(Number.parseInt(lastLine.slice(0, 3), 10))) {
        throw new MailUnavailableError(`unexpected reply ${lastLine}`);
      }
    },
  };
};

export class Mailer {
  constructor(private readonly config: MailConfig) {}

  /** Delivers exactly one email, or throws when the mail server will not take it. */
  async send(envelope: Envelope): Promise<void> {
    const timeoutMs = this.config.timeoutSeconds * 1000;
    const socket = createConnection({ host: this.config.host, port: this.config.port });
    socket.setTimeout(timeoutMs);

    const failure = new Promise<never>((_resolve, reject) => {
      socket.once('error', (error: Error) => reject(new MailUnavailableError(error.message)));
      socket.once('timeout', () => reject(new MailUnavailableError('timed out')));
      socket.once('close', () => reject(new MailUnavailableError('connection closed')));
    });
    void failure.catch(() => undefined);

    const conversation = openConversation(socket);
    const talk = async (): Promise<void> => {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      await conversation.expect([220]);
      await conversation.expect([250], 'EHLO ottolinerask.example');
      await conversation.expect([250], `MAIL FROM:<${addressOf(envelope.from)}>`);
      await conversation.expect([250], `RCPT TO:<${envelope.to}>`);
      await conversation.expect([354], 'DATA');
      const data = buildMessage(envelope)
        .split('\r\n')
        .map((line) => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n');
      socket.write(`${data}\r\n.\r\n`);
      await conversation.expect([250]);
      socket.write('QUIT\r\n');
    };

    try {
      await Promise.race([talk(), failure]);
    } catch (error) {
      throw error instanceof MailUnavailableError
        ? error
        : new MailUnavailableError(String(error));
    } finally {
      socket.destroy();
    }
  }

  /** Whether the mail server accepts a connection right now. */
  async accepts(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: this.config.host, port: this.config.port });
      socket.setTimeout(this.config.timeoutSeconds * 1000);
      const finish = (accepted: boolean): void => {
        socket.destroy();
        resolve(accepted);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    });
  }

  get from(): string {
    return this.config.from;
  }
}
