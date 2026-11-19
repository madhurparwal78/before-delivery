import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from './config';

export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  date: Date;
}

/** A small SMTP gateway; reachability is probed by the health loop. */
export class Mail {
  private transporter: Transporter;
  private available = false;

  constructor(config: Config) {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 8000,
    });
  }

  async check(): Promise<boolean> {
    try {
      const res = await this.transporter.verify();
      this.available = res;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(v: boolean): void {
    this.available = v;
  }

  async send(message: MailMessage, fromLine: string): Promise<void> {
    await this.transporter.sendMail({
      from: fromLine,
      to: message.toName ? `"${encodeHeaderName(message.toName)}" <${message.to}>` : message.to,
      subject: message.subject,
      text: message.body,
      date: message.date,
    });
    this.available = true;
  }
}

function encodeHeaderName(name: string): string {
  // nodemailer handles RFC 2047 encoding of non-ASCII display names.
  return name.replace(/"/g, '');
}
