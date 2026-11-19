import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "./config.js";

// Every message goes through SMTP to Mailpit. When SMTP is unreachable the
// notice stays queued and is retried by the notices worker.

export class MailClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  newTransporter(): Transporter {
    return nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }

  async ping(): Promise<boolean> {
    const transporter = this.newTransporter();
    try {
      await transporter.verify();
      return true;
    } catch {
      return false;
    } finally {
      transporter.close();
    }
  }

  async send(to: string, subject: string, body: string): Promise<boolean> {
    const transporter = this.newTransporter();
    try {
      await transporter.sendMail({
        from: this.config.mailFrom,
        to,
        subject,
        text: body,
      });
      return true;
    } catch {
      return false;
    } finally {
      transporter.close();
    }
  }
}
