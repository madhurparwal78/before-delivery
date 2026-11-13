import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { newId } from "./crypto.js";

export type PendingMail = {
  id: string;
  to: string;
  subject: string;
  body: string;
  memberId: string | null;
};

/** Queue a mail: it is first written to Postgres and delivered from there. */
export async function queueMail(
  db: Database,
  mail: { to: string; subject: string; body: string; memberId?: string | null }
): Promise<void> {
  await db.exec(
    `INSERT INTO pending_mail (id, to_address, subject, body, member_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [newId("mail"), mail.to, mail.subject, mail.body, mail.memberId ?? null]
  );
}

export class Mailer {
  private transporter: Transporter;

  constructor(private config: Config) {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      ignoreTLS: true,
    });
  }

  /** Deliver any unsent pending mail; retried on a timer until accepted. */
  async deliverPending(db: Database): Promise<void> {
    const rows = await db.query<{
      id: string;
      to_address: string;
      subject: string;
      body: string;
      attempts: number;
    }>(
      `SELECT id, to_address, subject, body, attempts FROM pending_mail
       WHERE sent_at IS NULL
       ORDER BY created_at ASC
       LIMIT 50`
    );
    for (const row of rows) {
      try {
        await this.transporter.sendMail({
          from: this.config.smtp.from,
          to: row.to_address,
          subject: row.subject,
          text: row.body,
        });
        await db.exec(`UPDATE pending_mail SET sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
      } catch {
        await db.exec(`UPDATE pending_mail SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      }
    }
  }
}
