import nodemailer from 'nodemailer';
import { env } from './env';

export type Mailer = {
  sendMail: (opts: { to: string; subject: string; text: string; html?: string }) => Promise<void>;
  isUp: () => Promise<boolean>;
};

export function createMailer(): Mailer {
  const e = env();
  const transport = nodemailer.createTransport({
    host: e.smtp.host,
    port: e.smtp.port,
    secure: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  }, { from: e.smtp.from });
  let okCache = true;
  return {
    async sendMail(opts) {
      try {
        await transport.sendMail({ from: e.smtp.from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
        okCache = true;
      } catch (err) {
        okCache = false;
        throw err;
      }
    },
    async isUp() {
      try {
        return await transport.verify();
      } catch {
        return false;
      }
    },
  };
}

export interface VerificationInfo { email: string; code: string; }
export interface DigestInfo { email: string; count: number; items: string[]; }

export function verificationMail(info: VerificationInfo): { subject: string; text: string; html: string } {
  const subject = 'Your Everyweek verification code';
  const text = `Your Everyweek verification code is ${info.code}.`;
  const html = `<p>Your Everyweek verification code is <strong>${info.code}</strong>.</p>`;
  return { subject, text, html };
}

export function digestMail(info: DigestInfo): { subject: string; text: string; html: string } {
  const subject = `Everyweek: ${info.count} unread in your inbox`;
  const text = info.items.map(i => i).join('\n');
  const html = `<p>${info.items.map(i => escapeHtml(i)).join('<br/>')}</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
