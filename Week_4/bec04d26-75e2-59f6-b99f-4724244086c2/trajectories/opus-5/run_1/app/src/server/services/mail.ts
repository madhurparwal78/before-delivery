import { config } from '../config';
import { reachable, sendMessage, SmtpTarget } from './smtp';

const target: SmtpTarget = { host: config.smtpHost, port: config.smtpPort };

export interface Message {
  to: string;
  subject: string;
  body: string;
}

/** True only when Mailpit accepted the message. */
export async function deliver(message: Message): Promise<boolean> {
  try {
    await sendMessage(target, {
      from: config.mailFrom,
      to: message.to,
      subject: message.subject,
      body: message.body,
    });
    return true;
  } catch {
    return false;
  }
}

export async function mailReachable(): Promise<boolean> {
  return reachable(target);
}
