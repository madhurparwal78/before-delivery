import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export const SALES_INBOX = 'sales@example.com';

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    this.transporter = createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 6000
    });
    this.from = process.env.MAIL_FROM ?? 'studio@example.com';
  }

  /** A stored change stands even when its mail cannot be delivered. */
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (error) {
      this.logger.error(`could not deliver "${message.subject}" to ${message.to}: ${(error as Error).message}`);
    }
  }

  publicUrl(path: string): string {
    const base = (process.env.APP_PUBLIC_URL ?? '').replace(/\/+$/, '');
    return `${base}${path}`;
  }
}
