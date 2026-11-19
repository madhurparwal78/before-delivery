import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 4000,
  greetingTimeout: 4000,
  socketTimeout: 6000,
});

export class MailUnreachable extends Error {}

export type Attachment = { filename: string; content: Buffer; contentType: string };

async function send(message: nodemailer.SendMailOptions): Promise<void> {
  try {
    await transport.sendMail({ from: config.mailFrom, ...message });
  } catch (error) {
    throw new MailUnreachable((error as Error).message);
  }
}

export async function sendConfirmationCode(to: string, code: string): Promise<void> {
  await send({
    to,
    subject: 'Your Hushfoot confirmation code',
    text: `Your code is ${code}.`,
  });
}

export async function sendPostcard(options: {
  to: string;
  senderName: string;
  islandName: string;
  creatureName: string;
  total: number;
  line: string;
  url: string;
  attachment: Attachment;
}): Promise<void> {
  const body = [options.line, `${options.creatureName}, ${options.total} points`, options.url].join('\n\n');
  await send({
    to: options.to,
    subject: `A postcard from ${options.senderName} on ${options.islandName}`,
    text: body,
    attachments: [options.attachment],
  });
}
