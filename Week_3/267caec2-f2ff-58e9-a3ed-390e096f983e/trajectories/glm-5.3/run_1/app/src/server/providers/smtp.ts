import nodemailer from "nodemailer";
import type { Config } from "../config.js";

export interface MailResult {
  ok: boolean;
  error?: string;
}

export class Mailer {
  private readonly host: string;
  private readonly port: number;
  private readonly from: string;

  constructor(cfg: Config["smtp"]) {
    this.host = cfg.host;
    this.port = cfg.port;
    this.from = cfg.from;
  }

  private transport(): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: false,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      tls: { rejectUnauthorized: false },
    });
  }

  async send(to: string, subject: string, body: string): Promise<MailResult> {
    try {
      await this.transport().sendMail({ from: this.from, to, subject, text: body });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "smtp failed" };
    }
  }

  async ping(): Promise<boolean> {
    return (await this.send("desk@cutline.example", "Cutline ping", "ping")).ok;
  }
}
