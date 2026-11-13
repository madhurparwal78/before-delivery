import nodemailer from 'nodemailer';
import { config } from './config.js';

export class MailDown extends Error {}

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  connectionTimeout: 10_000,
  tls: { rejectUnauthorized: false },
});

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html: html ?? `<pre>${escapeHtml(text)}</pre>`,
    });
    return true;
  } catch (err) {
    throw new MailDown(String(err));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
