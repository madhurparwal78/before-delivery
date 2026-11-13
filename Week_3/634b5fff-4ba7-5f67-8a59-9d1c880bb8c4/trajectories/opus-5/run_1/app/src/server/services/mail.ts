import nodemailer from 'nodemailer';
import { config } from '../config.js';

export class MailUnreachable extends Error {}

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  tls: { rejectUnauthorized: false },
});

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, html });
  } catch (error) {
    throw new MailUnreachable(String(error));
  }
}
