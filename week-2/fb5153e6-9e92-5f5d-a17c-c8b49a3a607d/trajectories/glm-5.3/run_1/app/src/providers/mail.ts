import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { markService } from './availability.js';

const transport: Transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  tls: { rejectUnauthorized: false },
  connectionTimeout: 5000,
});

export interface OutgoingEmail {
  to: string;
  locale: 'en' | 'de';
  subject: string;
  text: string;
}

export async function pingMail(): Promise<void> {
  await transport.verify();
  markService('mail', true);
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  await transport.sendMail({
    from: config.smtp.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
  });
  markService('mail', true);
}
