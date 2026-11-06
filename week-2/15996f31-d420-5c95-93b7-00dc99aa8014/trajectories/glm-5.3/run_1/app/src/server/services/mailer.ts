import type { Transporter } from "nodemailer";
import type { Config } from "../config.ts";
import { createTransport } from "nodemailer";
import type { Pool } from "../db.ts";
import { newId } from "../seed.ts";

/**
 * Email outbox backed by PostgreSQL. Each email is written once together with
 * the change that triggers it, and sent only after that change commits. The
 * outbox retries every 10 seconds until each message is delivered once.
 */
export interface PendingEmail {
  to: string;
  subject: string;
  body: string;
}

export async function queueEmail(client: { query: (text: string, params: readonly unknown[]) => Promise<unknown> }, email: PendingEmail): Promise<void> {
  await client.query(
    "INSERT INTO email_outbox (id, to_email, subject, body) VALUES ($1,$2,$3,$4)",
    [newId("eml"), email.to, email.subject, email.body],
  );
}

export class Mailer {
  private readonly config: Config;
  private readonly pool: Pool;
  private readonly instanceId = newId("inst");
  private transporter: Transporter | null = null;

  constructor(config: Config, pool: Pool) {
    this.config = config;
    this.pool = pool;
  }

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      });
    }
    return this.transporter;
  }

  private parseFrom(): { name: string; address: string } {
    const raw = this.config.mailFrom;
    const match = /^(.*)<(.*)>$/.exec(raw.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { name: match[1].trim().replace(/"/g, ""), address: match[2].trim() };
    }
    return { name: "Swarmline Bloom Desk", address: raw };
  }

  /** Atomically claims one pending message and tries to send it once. */
  async drainOnce(): Promise<void> {
    const claimed = await this.pool.query(
      `UPDATE email_outbox
       SET lease_until = now() + interval '30 seconds', locked_by = $1, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM email_outbox
         WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < now())
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, to_email, subject, body`,
      [this.instanceId],
    );
    const message = claimed.rows[0] as { id: string; to_email: string; subject: string; body: string } | undefined;
    if (!message) return;
    const from = this.parseFrom();
    let delivered = false;
    try {
      await this.transport().sendMail({
        from: { name: from.name, address: from.address },
        to: message.to_email,
        subject: message.subject,
        text: message.body,
      });
      delivered = true;
    } catch {
      delivered = false;
    }
    if (delivered) {
      await this.pool.query("UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1", [message.id]);
    }
  }

  /** Nudges the worker without blocking the response that queued the email. */
  kick(): void {
    this.drainOnce().catch(() => undefined);
  }

  async start(intervalMs = 10_000): Promise<void> {
    const tick = async () => {
      try {
        for (let i = 0; i < 20; i += 1) {
          const before = await this.pool.query("SELECT count(*)::int AS count FROM email_outbox WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < now())");
          const count = (before.rows[0] as { count: number }).count;
          if (count === 0) break;
          await this.drainOnce();
        }
      } catch {
        // SMTP or the database may be unreachable; the next tick retries.
      }
    };
    await tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
  }
}
