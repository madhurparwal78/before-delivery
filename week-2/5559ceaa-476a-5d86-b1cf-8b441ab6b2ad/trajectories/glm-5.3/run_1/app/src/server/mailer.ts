import { createTransport, type Transporter } from "nodemailer";
import type { Config } from "./config.js";
import { randomBytes } from "node:crypto";

export interface MailQueryTarget {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export class Mailer {
  private cfg: Config;
  private transport: Transporter | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  private getTransport(): Transporter {
    if (!this.transport) {
      this.transport = createTransport({
        host: this.cfg.smtp.host,
        port: this.cfg.smtp.port,
        secure: false,
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 4000,
      });
    }
    return this.transport;
  }

  /** Deliver a message now. Returns "sent" or throws. */
  async send(to: string, subject: string, text: string): Promise<void> {
    await this.getTransport().sendMail({
      from: this.cfg.mailFrom,
      to,
      subject,
      text,
    });
  }

  /** Try to send an email and record it as sent or queued. */
  async sendOrQueue(target: MailQueryTarget, to: string, subject: string, body: string): Promise<"sent" | "queued"> {
    try {
      await this.send(to, subject, body);
      return "sent";
    } catch {
      const id = randomBytes(16).toString("hex");
      await target.query(
        `INSERT INTO email_queue (id, to_email, subject, body, status) VALUES ($1,$2,$3,$4,'queued')`,
        [id, to, subject, body],
      );
      return "queued";
    }
  }
}
