import nodemailer from "nodemailer";
import type { Pool } from "pg";
import type { Config } from "./config.js";

type OutboxRow = { id: number; to_address: string; subject: string; body: string; attempts: number };

/** Emails are queued in Postgres and retried every 10 seconds until Mailpit accepts them. */
export class MailQueue {
  private readonly pool: Pool;
  private readonly cfg: Config["smtp"];
  private running = false;

  constructor(pool: Pool, cfg: Config["smtp"]) {
    this.pool = pool;
    this.cfg = cfg;
  }

  async enqueue(to: string, subject: string, body: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO email_outbox (to_address, subject, body) VALUES ($1, $2, $3)",
      [to, subject, body],
    );
  }

  async flushOnce(): Promise<number> {
    const { rows } = await this.pool.query<OutboxRow>(
      "SELECT id, to_address, subject, body, attempts FROM email_outbox ORDER BY id LIMIT 25",
    );
    if (rows.length === 0) return 0;
    let sent = 0;
    for (const row of rows) {
      try {
        await this.sendNow(row.to_address, row.subject, row.body);
        await this.pool.query("DELETE FROM email_outbox WHERE id = $1", [row.id]);
        sent++;
      } catch {
        await this.pool.query("UPDATE email_outbox SET attempts = attempts + 1 WHERE id = $1", [row.id]);
      }
    }
    return sent;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.flushOnce();
      } catch {
        // database hiccup; retry next tick
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }

  private async sendNow(to: string, subject: string, body: string): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: false,
      ignoreTLS: true,
    });
    await transport.sendMail({
      from: this.cfg.from,
      to,
      subject,
      text: body,
    });
    transport.close();
  }
}
