import { createConnection } from 'node:net';
import { config } from './config';
import { deliver } from './smtp';
import { hex } from './util';

export class MailUnavailable extends Error {}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

function address(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from.trim() : match[1].trim();
}

function headerValue(text: string): string {
  if (/^[ -~]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function build(mail: Mail): Buffer {
  const body = Buffer.from(mail.text, 'utf8').toString('base64');
  const wrapped = body.match(/.{1,76}/g) ?? [''];
  const lines = [
    `From: ${config.mailFrom}`,
    `To: ${mail.to}`,
    `Subject: ${headerValue(mail.subject)}`,
    `Message-ID: <${hex(12)}@switchyard.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    ...Object.entries(mail.headers ?? {}).map(([name, value]) => `${name}: ${headerValue(value)}`),
    '',
    ...wrapped,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/** Resolves only once the mail server has accepted the message. */
export async function sendMail(mail: Mail): Promise<void> {
  try {
    await deliver({
      host: config.smtp.host,
      port: config.smtp.port,
      from: address(config.mailFrom),
      to: mail.to,
      message: build(mail),
    });
  } catch (error) {
    throw new MailUnavailable(String(error));
  }
}

export function mailReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const done = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

export const mailTexts = {
  confirmSubject: 'Confirm your Pinbyte Switchyard account',
  confirmBody: (name: string, token: string): string =>
    `Hello ${name},\n\nConfirm your Pinbyte Switchyard account by opening this link:\n\n${config.publicUrl}/confirm/${token}\n\nIf you did not create an account you can ignore this message.\n`,
  inviteSubject: (inviter: string, workspace: string): string =>
    `${inviter} invited you to ${workspace} on Pinbyte Switchyard`,
  inviteBody: (inviter: string, workspace: string, token: string): string =>
    `${inviter} invited you to the ${workspace} workspace on Pinbyte Switchyard.\n\nJoin here:\n\n${config.publicUrl}/invite/${token}\n`,
} as const;
