import nodemailer from 'nodemailer';
import type { AppConfig } from './config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends one message per call over a fresh connection; returns false on outage. */
export async function sendMail(config: AppConfig, message: MailMessage): Promise<boolean> {
  try {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
    await transport.sendMail({
      from: config.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    transport.close();
    return true;
  } catch {
    return false;
  }
}
