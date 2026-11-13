import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

let transporter: Transporter | null = null;

function smtp(): Transporter {
  if (transporter) return transporter;
  const cfg = config();
  transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });
  return transporter;
}

export async function smtpAvailable(): Promise<boolean> {
  try {
    await smtp().verify();
    return true;
  } catch {
    return false;
  }
}

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export async function sendMail(message: MailMessage): Promise<void> {
  const cfg = config();
  await smtp().sendMail({
    from: cfg.mailFrom,
    to: message.to,
    subject: message.subject,
    text: message.body,
  });
}
