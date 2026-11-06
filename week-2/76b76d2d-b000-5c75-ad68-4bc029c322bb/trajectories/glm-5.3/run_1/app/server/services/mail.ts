import * as nodemailer from 'nodemailer';
import type { Config } from '../config';

export interface ProbeResult { up: boolean }

/**
 * Mailpit over SMTP: the one way transactional email leaves this app.
 * The connect probe shares the transporter but never sends.
 */
export class MailService {
  private readonly cfg: Config;
  private transporter: nodemailer.Transporter | null = null;
  private probing = false;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  private getTransport(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.cfg.smtpHost,
        port: this.cfg.smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5000,
        socketTimeout: 5000,
        greetingTimeout: 5000,
      });
    }
    return this.transporter;
  }

  /** A connect probe: true when SMTP accepts a connection within 5 seconds. */
  async probe(): Promise<ProbeResult> {
    if (this.probing) return { up: false };
    this.probing = true;
    try {
      const transport = this.getTransport() as nodemailer.Transporter & { verify(): Promise<true> };
      await transport.verify();
      return { up: true };
    } catch {
      return { up: false };
    } finally {
      this.probing = false;
    }
  }

  async send(input: {
    to: string; subject: string; text: string; html: string; messageKey: string;
  }): Promise<void> {
    const fromNameMatch = /^(.*?)\s*<(.*)>$/.exec(this.cfg.mailFrom);
    const from = this.cfg.mailFrom;
    const domain = fromNameMatch ? fromNameMatch[2].split('@')[1] : 'halide.example';
    await this.getTransport().sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: {
        'X-Halide-Message-Key': input.messageKey,
      },
      messageId: `<${input.messageKey.replace(/[^a-zA-Z0-9-]/g, '-')}-${Date.now()}@${domain}>`,
    });
  }
}
