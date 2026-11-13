import nodemailer from 'nodemailer';
import type { AppConfig } from './config';

/**
 * SMTP through Mailpit. Liveness is reported so mail can wait in the
 * visible outbox while SMTP is unreachable, and be sent exactly once.
 */
export class Mail {
  private transporter: nodemailer.Transporter;
  private from: string;
  private up = false;

  constructor(config: AppConfig) {
    this.from = config.smtp.from;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 5000,
    } as nodemailer.TransportOptions);
  }

  isUp(): boolean {
    return this.up;
  }

  async probe(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.up = true;
    } catch {
      this.up = false;
    }
    return this.up;
  }

  /** Send one message. Throws while SMTP is unreachable. */
  async send(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text: body,
    });
    this.up = true;
  }
}
