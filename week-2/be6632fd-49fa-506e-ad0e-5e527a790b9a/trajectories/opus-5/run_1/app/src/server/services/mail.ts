import { config } from '../config.ts';
import { encodeHeaderWord, sendOverSmtp } from './smtp.ts';

export interface Message {
  toName: string | null;
  toAddress: string;
  subject: string;
  body: string;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match === null ? from : (match[1] as string)).trim();
}

/** A name only ever appears as an encoded display name, so it can never add a header. */
function toHeader(message: Message): string {
  if (message.toName === null || message.toName === '') return message.toAddress;
  return `${encodeHeaderWord(message.toName)} <${message.toAddress}>`;
}

export async function sendMessage(message: Message): Promise<void> {
  await sendOverSmtp({
    host: config.mail.host,
    port: config.mail.port,
    from: config.mail.from,
    fromAddress: addressOf(config.mail.from),
    toAddress: message.toAddress,
    headers: {
      From: config.mail.from,
      To: toHeader(message),
      Subject: encodeHeaderWord(message.subject),
    },
    body: message.body,
  });
}

export function absoluteLink(path: string): string {
  return `${config.publicUrl}${path}`;
}
