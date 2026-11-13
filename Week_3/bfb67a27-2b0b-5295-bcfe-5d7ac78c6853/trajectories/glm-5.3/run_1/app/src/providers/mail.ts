// Mailpit receives every mail; nothing is counted as sent until the SMTP server accepts it (DP-16, DP-46).

import nodemailer, { type Transporter } from 'nodemailer';

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export type MailResult = { ok: true } | { ok: false; reason: 'refused' };

const TIMEOUT_MS = 5000;

export class Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: MailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  }

  async send(to: string, subject: string, body: string): Promise<MailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to,
        subject,
        text: body,
      });
      if (info.accepted === undefined || info.accepted.length === 0) {
        return { ok: false, reason: 'refused' };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'refused' };
    }
  }

  async probe(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
