import nodemailer from 'nodemailer';
import type { Config } from './config.js';

type SendMailOptions = Parameters<nodemailer.Transporter['sendMail']>[0];

export class Mailer {
  private transporter: nodemailer.Transporter;

  constructor(cfg: Config) {
    this.transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: false,
      // No retries that would leave a mail unsent: the action is refused when the send fails.
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
    });
  }

  /** Send one mail. Throws when Mailpit is unreachable so the caller can refuse the action. */
  async send(options: SendMailOptions): Promise<void> {
    await this.transporter.sendMail({ from: options.from, to: options.to, subject: options.subject, text: options.text });
  }
}
