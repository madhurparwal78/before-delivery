import nodemailer from "nodemailer";
import type { Config } from "./config.js";
import { newId } from "./ids.js";
import { query } from "./db.js";

export interface MailJob {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

export async function queueMail(to: string, subject: string, body: string): Promise<void> {
  await query("INSERT INTO mail_queue (id, to_email, subject, body) VALUES ($1, $2, $3, $4)", [
    newId("mail"),
    to,
    subject,
    body,
  ]);
}

export function makeMailer(cfg: Config) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: false,
    ignoreTLS: true,
  });
}

/**
 * Sends queued mail. Each row is claimed in the database so it is sent exactly
 * once across all app processes.
 */
export async function sendQueuedMail(cfg: Config): Promise<void> {
  const { rows } = await query<MailJob>(
    `UPDATE mail_queue SET claimed_until = now() + interval '30 seconds'
     WHERE id IN (
       SELECT id FROM mail_queue
       WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
       ORDER BY created_at
       LIMIT 10
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_email, subject, body`
  );
  if (rows.length === 0) return;
  const mailer = makeMailer(cfg);
  for (const job of rows) {
    try {
      await mailer.sendMail({
        from: cfg.mailFrom,
        to: job.to_email,
        subject: job.subject,
        text: job.body,
      });
      await query("UPDATE mail_queue SET sent_at = now(), claimed_until = NULL WHERE id = $1", [job.id]);
    } catch {
      await query("UPDATE mail_queue SET attempts = attempts + 1, claimed_until = NULL WHERE id = $1", [job.id]);
    }
  }
}
