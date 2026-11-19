import nodemailer, { type Transporter } from 'nodemailer';
import type { Pool, PoolClient } from 'pg';

export type MailConfig = {
  host: string;
  port: number;
  from: string;
};

export type EmailKind = 'receipt' | 'offer' | 'exchange' | 'refund';

export type OutboxRow = {
  id: number;
  to_address: string;
  kind: EmailKind;
  subject: string;
  body: string;
  status: 'queued' | 'sent';
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
};

export class Mailer {
  private transporter: Transporter | null = null;
  private transportBroken = false;

  constructor(
    private readonly config: MailConfig,
    private readonly db: Pool,
  ) {}

  private transport(): Transporter {
    if (!this.transporter || this.transportBroken) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      });
      this.transportBroken = false;
    }
    return this.transporter;
  }

  async recordAndSend(
    client: PoolClient | Pool,
    message: { to: string; kind: EmailKind; subject: string; body: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox (to_address, kind, subject, body, status) VALUES ($1, $2, $3, $4, 'queued')`,
      [message.to, message.kind, message.subject, message.body],
    );
    await this.deliverPending();
  }

  async record(client: PoolClient | Pool, message: { to: string; kind: EmailKind; subject: string; body: string }): Promise<void> {
    await this.recordAndSend(client, message);
  }

  async deliverPending(): Promise<void> {
    const pending = await this.db.query<OutboxRow>(
      `SELECT id, to_address, kind, subject, body, status, attempts, created_at, sent_at
       FROM outbox WHERE status = 'queued' ORDER BY id ASC LIMIT 50`,
    );
    for (const row of pending.rows) {
      await this.trySend(row);
    }
  }

  private async trySend(row: OutboxRow): Promise<void> {
    try {
      await this.transport().sendMail({
        from: this.config.from,
        to: row.to_address,
        subject: row.subject,
        text: row.body,
      });
      await this.db.query(`UPDATE outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_attempt_at = now() WHERE id = $1`, [
        row.id,
      ]);
    } catch (error) {
      this.transportBroken = true;
      await this.db.query(
        `UPDATE outbox SET attempts = attempts + 1, last_attempt_at = now() WHERE id = $1 AND status = 'queued'`,
        [row.id],
      );
    }
  }

  startRetryLoop(): void {
    const tick = async () => {
      try {
        await this.deliverPending();
      } catch {
        /* retried on the next tick */
      }
    };
    const timer = setInterval(tick, 5_000);
    timer.unref();
  }
}
