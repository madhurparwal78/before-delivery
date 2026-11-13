import { config } from '../config.js';
import { deliver, greets, parseAddress } from './smtp.js';

export interface Message {
  to: string;
  subject: string;
  body: string;
}

const SEND_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;

/** Resolves only once the SMTP server has accepted the message. */
export async function sendMessage(message: Message): Promise<void> {
  await deliver(
    config.mail.host,
    config.mail.port,
    {
      from: parseAddress(config.mail.from),
      to: message.to,
      subject: message.subject,
      body: message.body,
      date: new Date(),
    },
    SEND_TIMEOUT_MS,
  );
}

export async function mailIsUp(): Promise<boolean> {
  return await greets(config.mail.host, config.mail.port, PROBE_TIMEOUT_MS);
}
