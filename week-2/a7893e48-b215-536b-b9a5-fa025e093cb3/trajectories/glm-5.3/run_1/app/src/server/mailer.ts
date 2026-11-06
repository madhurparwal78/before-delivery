import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { SMTP } from "./config.js";
import { pool } from "./db.js";

let mailOk = false;
export function mailHealthy(): boolean { return mailOk; }

export async function checkMail(): Promise<boolean> {
  try {
    const t = transport();
    await new Promise<void>((resolve, reject) => {
      t.verify((err: Error | null) => (err ? reject(err) : resolve()));
    });
    mailOk = true;
  } catch {
    mailOk = false;
  }
  return mailOk;
}

let cachedTransport: nodemailer.Transporter | null = null;
function transport(): nodemailer.Transporter {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: false,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      tls: { rejectUnauthorized: false },
    });
  }
  return cachedTransport;
}

export interface EmailJob {
  id: string;
  to: string;
  subject: string;
  body: string;
}

/** Insert exactly one queued email; the background loop delivers it. */
export async function queueEmail(to: string, subject: string, body: string): Promise<void> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO email_queue (id, to_email, subject, body) VALUES ($1,$2,$3,$4)`,
    [id, to, subject, body],
  );
}

export async function queuedCount(): Promise<number> {
  const r = await pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM email_queue WHERE sent_at IS NULL`);
  return Number(r.rows[0].c);
}

/** Try to deliver every unsent queued email, oldest first. */
export async function flushQueue(): Promise<void> {
  const r = await pool.query<{ id: string; to_email: string; subject: string; body: string }>(
    `SELECT id, to_email, subject, body FROM email_queue WHERE sent_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 50`,
  );
  if (r.rows.length === 0) return;
  if (!mailOk) {
    await checkMail();
    if (!mailOk) return;
  }
  for (const job of r.rows) {
    try {
      const t = transport();
      await new Promise<void>((resolve, reject) => {
        t.sendMail(
          {
            from: SMTP.from,
            to: job.to_email,
            subject: job.subject,
            text: job.body,
          },
          (err: Error | null) => (err ? reject(err) : resolve()),
        );
      });
      await pool.query(`UPDATE email_queue SET sent_at = now() WHERE id = $1`, [job.id]);
    } catch {
      // An explicit bounce is treated as undeliverable-but-accepted by Mailpit? No:
      // keep it queued and retry on the next flush.
      return;
    }
  }
}
