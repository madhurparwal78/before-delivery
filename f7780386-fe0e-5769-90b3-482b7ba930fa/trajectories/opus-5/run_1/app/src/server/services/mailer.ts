import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';

import type { SmtpConfig } from '../config.js';

export const MAIL_FROM_ADDRESS = 'passboard@halsted-kitchen.test';
export const MAIL_FROM_NAME = 'Passboard';

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('mail_unavailable');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

const CONNECT_TIMEOUT_MS = 6000;

/** RFC 2047 encoded word, needed for names such as "Tomás Reyes". */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(email: OutboundEmail, sentAt: Date): string {
  const headers = [
    `From: ${encodeHeader(MAIL_FROM_NAME)} <${MAIL_FROM_ADDRESS}>`,
    `To: ${email.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${sentAt.toUTCString()}`,
    `Message-ID: <${randomUUID()}@halsted-kitchen.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = email.body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

/**
 * A plain SMTP client for the mail sink. Each message is a single session so a
 * failed send never leaves a half-written conversation behind.
 */
export class Mailer {
  readonly #config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.#config = config;
  }

  async send(email: OutboundEmail, sentAt: Date): Promise<void> {
    const socket = createConnection({ host: this.#config.host, port: this.#config.port });
    socket.setEncoding('utf8');
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    let buffer = '';
    const pending: Array<(line: string) => void> = [];

    const readReply = (): Promise<string> =>
      new Promise((resolve) => {
        pending.push(resolve);
        drain();
      });

    const drain = (): void => {
      // A reply ends with "NNN " (space, not hyphen) on its final line.
      while (pending.length > 0) {
        const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buffer);
        if (!match) return;
        buffer = buffer.slice(match[0].length);
        pending.shift()?.(match[0]);
      }
    };

    const failure = new Promise<never>((_, reject) => {
      socket.on('error', (error) => reject(new MailUnavailable(error)));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new MailUnavailable(new Error('smtp timeout')));
      });
      socket.on('close', () => reject(new MailUnavailable(new Error('smtp closed'))));
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      drain();
    });

    const expect = async (codes: readonly string[]): Promise<void> => {
      const reply = await Promise.race([readReply(), failure]);
      const lastLine = reply.trimEnd().split('\n').pop()?.trim() ?? '';
      if (!codes.some((expected) => lastLine.startsWith(expected))) {
        throw new MailUnavailable(new Error(`smtp replied ${lastLine}`));
      }
    };

    const say = async (command: string, codes: readonly string[]): Promise<void> => {
      socket.write(`${command}\r\n`);
      await expect(codes);
    };

    try {
      await expect(['220']);
      await say(`EHLO passboard`, ['250']);
      await say(`MAIL FROM:<${MAIL_FROM_ADDRESS}>`, ['250']);
      await say(`RCPT TO:<${email.to}>`, ['250', '251']);
      await say('DATA', ['354']);
      socket.write(buildMessage(email, sentAt));
      await say('.', ['250']);
      socket.write('QUIT\r\n');
    } finally {
      socket.removeAllListeners('close');
      socket.end();
      socket.destroy();
    }
  }
}
