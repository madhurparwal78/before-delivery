// Mailpit SMTP delivery. Emails are queued in the same step as the action
// and retried until delivered; never duplicated by an idempotent replay.
import nodemailer, { type Transporter } from "nodemailer";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  private transporter: Transporter;
  private readonly from: string;
  private readonly queue: { id: string; email: OutgoingEmail; attempts: number }[] = [];
  private running = false;

  constructor(config: { host: string; port: number; from: string }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 10_000,
    });
    this.from = config.from;
  }

  // Queue an email with a unique id. Replays of an action never call this
  // again: the caller queues only when the action actually executes.
  queueEmail(id: string, email: OutgoingEmail): void {
    if (this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, email, attempts: 0 });
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        try {
          await this.transporter.sendMail({
            from: this.from,
            to: item.email.to,
            subject: item.email.subject,
            text: item.email.text,
          });
        } catch {
          item.attempts += 1;
          this.queue.push(item);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    } finally {
      this.running = false;
    }
  }
}
