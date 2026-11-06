import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

// Mail through Mailpit's SMTP. Recorded in PostgreSQL before sending; retried in the background.

export interface MailRecord {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
}

export class Mailer {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: Config) {}

  private transport(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: false,
        ignoreTLS: true,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 8000,
      });
    }
    return this.transporter;
  }

  async send(record: MailRecord): Promise<boolean> {
    try {
      await this.transport().sendMail({
        from: this.config.mailFrom,
        to: record.toEmail,
        subject: record.subject,
        text: record.body,
      });
      return true;
    } catch {
      return false;
    }
  }
}
