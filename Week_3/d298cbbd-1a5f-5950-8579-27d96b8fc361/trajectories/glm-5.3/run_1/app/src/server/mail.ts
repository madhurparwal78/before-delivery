import nodemailer, { type Transporter } from 'nodemailer';
import type { Store } from './store.js';
import type { AppConfig } from '../shared/config.js';

// Account mail through SMTP, with a database-backed retry.

export class MailService {
  private transporter: Transporter;
  private readonly store: Store;
  private readonly config: AppConfig;
  private timer: NodeJS.Timeout | null = null;

  constructor(store: Store, config: AppConfig) {
    this.store = store;
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: false,
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 8000,
    });
  }

  /** Queue a message and try to send it at once. */
  async send(to: string, subject: string, body: string): Promise<'sent' | 'retrying'> {
    await this.store.queueMail(to, subject, body);
    return this.flushOnce();
  }

  async flushOnce(): Promise<'sent' | 'retrying'> {
    const pending = await this.store.pendingMail();
    if (pending.length === 0) return 'sent';
    try {
      for (const message of pending) {
        await this.transporter.sendMail({
          from: this.config.mailFrom,
          to: message.to,
          subject: message.subject,
          text: message.body,
        });
        await this.store.markMailDelivered(message.id);
      }
      return 'sent';
    } catch {
      this.scheduleRetry();
      return 'retrying';
    }
  }

  private scheduleRetry(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushOnce();
    }, this.config.mailRetrySeconds * 1000);
    this.timer.unref();
  }

  start(): void {
    void this.flushOnce();
  }
}

export function verificationBody(publicUrl: string, token: string): { subject: string; body: string } {
  return {
    subject: 'Verify your Strikeproof account',
    body: `Verify: ${publicUrl}/verify/${token}\n`,
  };
}

export function resetBody(publicUrl: string, token: string): { subject: string; body: string } {
  return {
    subject: 'Reset your Strikeproof password',
    body: `Reset: ${publicUrl}/reset/${token}\n`,
  };
}
