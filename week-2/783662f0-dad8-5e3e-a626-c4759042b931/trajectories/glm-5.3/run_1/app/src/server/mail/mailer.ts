/** Mail: every mail is first held, then sent through SMTP exactly once. */

import nodemailer from "nodemailer";
import { config } from "../config.js";
import { randomBytes } from "node:crypto";
import type { Pool } from "../db/pool.js";

export type MailKind = "invite" | "overdue_warning" | "receipt" | "coin_receipt" | "coin_refund" | "game_result";

export function newId(): string {
  return randomBytes(10).toString("hex");
}

export function queueMail(pool: Pool, input: { kind: MailKind; serverId: string; toEmail: string; toHandle?: string; subject: string; body: string }): Promise<void> {
  return pool
    .query(
      "INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state) VALUES ($1,$2,$3,$4,$5,$6,$7,'held')",
      [newId(), input.serverId, input.kind, input.toHandle ?? null, input.toEmail, input.subject, input.body]
    )
    .then(() => undefined);
}

let transporter: nodemailer.Transporter | null = null;

function mailer(): nodemailer.Transporter {
  if (transporter !== null) return transporter;
  const cfg = config().smtp;
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: false,
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 6000,
  });
  return transporter;
}

export async function smtpReachable(): Promise<boolean> {
  try {
    await mailer().verify();
    return true;
  } catch {
    return false;
  }
}

/** Sends one held mail under a row lock, so each mail is sent exactly once. */
export async function sendOneHeldMail(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query<{ id: string; to_email: string; subject: string; body: string }>(
      "SELECT id, to_email, subject, body FROM mail_outbox WHERE state = 'held' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
    );
    if (claimed.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    const row = claimed.rows[0]!;
    let sent = false;
    try {
      await mailer().sendMail({ from: config().smtp.from, to: row.to_email, subject: row.subject, text: row.body });
      sent = true;
    } catch {
      sent = false;
    }
    if (sent) {
      await client.query("UPDATE mail_outbox SET state = 'sent', sent_at = now() WHERE id = $1", [row.id]);
      await client.query("COMMIT");
      return true;
    }
    await client.query("ROLLBACK");
    return false;
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    return false;
  } finally {
    client.release();
  }
}

export async function retryHeldMail(pool: Pool): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const sent = await sendOneHeldMail(pool);
    if (!sent) break;
  }
}
