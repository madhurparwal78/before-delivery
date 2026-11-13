import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { config } from './config.js';

const options: SMTPTransport.Options = {
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  connectionTimeout: 4000,
  greetingTimeout: 4000,
  socketTimeout: 8000,
  tls: { rejectUnauthorized: false },
};

export const mailer = nodemailer.createTransport(options);

export async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
  try {
    await mailer.sendMail({ from: config.mailFrom, to, subject, text: body });
    return true;
  } catch {
    return false;
  }
}

export async function checkMail(): Promise<boolean> {
  try {
    await Promise.race([
      nodemailer.createTransport(options).verify(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return true;
  } catch {
    return false;
  }
}
