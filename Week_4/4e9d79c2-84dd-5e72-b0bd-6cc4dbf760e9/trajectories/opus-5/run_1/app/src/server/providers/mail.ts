import { createTransport } from 'nodemailer';
import { config } from '../config.js';

const transport = createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  tls: { rejectUnauthorized: false },
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 5000,
});

export class MailDown extends Error {}

export type Mail = { to: string; subject: string; text: string };

export async function sendMail(mail: Mail): Promise<void> {
  try {
    await transport.sendMail({ from: config.smtp.from, to: mail.to, subject: mail.subject, text: mail.text });
  } catch (trouble) {
    throw new MailDown(trouble instanceof Error ? trouble.message : 'mail did not send');
  }
}
