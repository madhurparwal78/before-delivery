// Mail: every message goes through an outbox in Postgres so each event yields exactly one accepted message.
import nodemailer, { type Transporter } from 'nodemailer';
import type { Db } from './db';

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export interface OutboxMessage {
  id: number;
  to_email: string;
  subject: string;
  body: string;
}

const RETRY_SECONDS = 30;

export class Mailer {
  private transporter: Transporter | null = null;
  private sweeping = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: MailConfig,
    private readonly db: Db,
  ) {}

  /** Queue a message; the sweep sends it. Called only after the change it reports is committed. */
  async enqueue(toEmail: string, subject: string, body: string): Promise<void> {
    await this.db.query('INSERT INTO email_outbox (to_email, subject, body) VALUES ($1, $2, $3)', [toEmail, subject, body]);
    this.scheduleSweep(0);
    await this.sweep().catch(() => {});
  }

  /** Send every unsent message; called on a timer and after enqueue. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const pending = await this.db.query<OutboxMessage>(
        'SELECT id, to_email, subject, body FROM email_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 50',
      );
      for (const message of pending) {
        const sent = await this.trySend(message);
        if (sent) {
          await this.db.exec('UPDATE email_outbox SET sent_at = now() WHERE id = $1', [message.id]);
        } else {
          break; // SMTP is refusing; retry later, keeping order
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async trySend(message: OutboxMessage): Promise<boolean> {
    try {
      if (this.transporter === null) {
        this.transporter = nodemailer.createTransport({ host: this.config.host, port: this.config.port, secure: false });
      }
      await this.transporter.sendMail({
        from: this.config.from,
        to: message.to_email,
        subject: message.subject,
        text: message.body,
      });
      return true;
    } catch {
      this.transporter = null;
      return false;
    }
  }

  private scheduleSweep(delayMs: number): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const jitter = delayMs === 0 ? 0 : delayMs + Math.random() * 500;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sweep().catch(() => this.scheduleSweep(RETRY_SECONDS * 1000));
    }, jitter);
    this.retryTimer.unref?.();
  }

  start(): void {
    this.scheduleSweep(0);
    // A periodic sweep, in case an enqueue lands between schedules.
    this.periodicTimer = setInterval(() => {
      void this.sweep().catch(() => {});
    }, RETRY_SECONDS * 1000);
    this.periodicTimer.unref?.();
  }
}
