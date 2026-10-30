import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "./env";

interface QueuedMail {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
}

export class Mailer {
  private transporter: Transporter | null = null;
  private queue: QueuedMail[] = [];
  private flushing = false;

  constructor(private env: Env) {}

  private ensureTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.env.smtp.host,
        port: this.env.smtp.port,
        secure: false,
        connectionTimeout: 5000,
      });
    }
    return this.transporter;
  }

  send(opts: { to: string[]; subject: string; text: string; fromName?: string }): void {
    this.queue.push({ to: opts.to.join(", "), subject: opts.subject, text: opts.text, fromName: opts.fromName });
    this.flush().catch(() => {});
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const mail = this.queue[0]!;
        try {
          await this.ensureTransporter().sendMail({
            from: { name: mail.fromName ?? this.env.mailFrom.name, address: this.env.mailFrom.address },
            to: mail.to,
            subject: mail.subject.replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim(),
            text: mail.text,
          });
          this.queue.shift();
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async check(): Promise<boolean> {
    try {
      await this.ensureTransporter().verify();
      return true;
    } catch {
      return false;
    }
  }
}
