import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

function encodedWords(value: string): string {
  const words: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (chunkBytes + size > 42) {
      words.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += size;
  }
  if (chunk !== '') words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** A header value that is kept verbatim when it is plain ASCII and encoded otherwise. */
export function encodeHeaderText(value: string): string {
  return ASCII_PRINTABLE.test(value) ? value : encodedWords(value);
}

/** `"Hale, Imogen \"Imo\"" <imo@x.example>` or an encoded word for non-ASCII names. */
export function formatMailbox(displayName: string, address: string): string {
  if (ASCII_PRINTABLE.test(displayName)) {
    const quoted = displayName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${quoted}" <${address}>`;
  }
  return `${encodedWords(displayName)} <${address}>`;
}

export type Mailbox = { name: string; address: string };

export type RenderedMessage = {
  to: string;
  bytes: Buffer;
};

export function renderMessage(input: {
  to: Mailbox;
  replyTo?: Mailbox;
  subject: string;
  body: string;
  queuedAt: Date;
}): RenderedMessage {
  const base64 = Buffer.from(input.body, 'utf8').toString('base64');
  const wrapped = (base64.match(/.{1,76}/g) ?? []).join('\r\n');
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${formatMailbox(input.to.name, input.to.address)}`,
    ...(input.replyTo === undefined ? [] : [`Reply-To: ${formatMailbox(input.replyTo.name, input.replyTo.address)}`]),
    `Subject: ${encodeHeaderText(input.subject)}`,
    `Date: ${input.queuedAt.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@kettlehole.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return {
    to: input.to.address,
    bytes: Buffer.from(`${headers.join('\r\n')}\r\n\r\n${wrapped}\r\n`, 'utf8'),
  };
}
