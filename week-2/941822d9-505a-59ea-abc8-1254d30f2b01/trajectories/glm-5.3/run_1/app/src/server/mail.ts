import nodemailer from "nodemailer";
import { config } from "./config.ts";
import { query } from "./db.ts";

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  ignoreTLS: true,
});

export type QueuedEmail = { to: string; subject: string; body: string };

export async function queueEmail(email: QueuedEmail): Promise<void> {
  await query(
    `INSERT INTO email_outbox (id, to_email, subject, body) VALUES (gen_random_uuid(), $1, $2, $3)`,
    [email.to, email.subject, email.body],
  );
}

async function deliverOne(id: string, to: string, subject: string, body: string): Promise<boolean> {
  try {
    await transporter.sendMail({ from: config.smtp.from, to, subject, text: body });
    await query(`UPDATE email_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [id]);
    return true;
  } catch {
    await query(`UPDATE email_outbox SET attempts = attempts + 1 WHERE id = $1`, [id]);
    return false;
  }
}

export async function runOutboxLoop(): Promise<void> {
  for (;;) {
    try {
      const { rows } = await query<{ id: string; to_email: string; subject: string; body: string }>(
        `SELECT id, to_email, subject, body FROM email_outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 10`,
      );
      if (rows.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      for (const row of rows) {
        await deliverOne(row.id, row.to_email, row.subject, row.body);
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
