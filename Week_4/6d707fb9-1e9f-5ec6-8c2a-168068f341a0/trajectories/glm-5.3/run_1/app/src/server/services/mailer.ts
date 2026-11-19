import nodemailer from "nodemailer";
import type { Config } from "../config/env.js";
import { rows } from "../db/pool.js";
import { instantOf } from "../engine/time.js";

/**
 * Mail delivery over SMTP to Mailpit. Every copy delivers its own pending mail, and a
 * mail not yet accepted is tried again.
 */
export class Mailer {
  private transporter: nodemailer.Transporter;

  constructor(config: Config) {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 5000,
    });
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const config = readMailConfig();
    await this.transporter.sendMail({
      from: config.mailFrom,
      to,
      subject,
      text: body,
    });
  }
}

import { readConfig } from "../config/env.js";
function readMailConfig(): Config {
  return readConfig();
}

/** Queue a mail for delivery; each copy delivers its own queue. */
export async function queueMail(to: string, subject: string, body: string): Promise<void> {
  const { newId } = await import("../engine/ids.js");
  await rows(
    `INSERT INTO mail_queue (id, to_email, subject, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [newId(), to, subject, body, instantOf(new Date())],
  );
}

/** Deliver every pending mail in this copy's database, dropping mail for closed labels. */
export async function deliverPending(mailer: Mailer, openLabelEmails: (to: string) => Promise<boolean>): Promise<void> {
  const pending = await rows<{ id: string; to_email: string; subject: string; body: string }>(
    `SELECT id, to_email, subject, body FROM mail_queue WHERE sent_at IS NULL ORDER BY created_at ASC LIMIT 50`,
  );
  for (const m of pending) {
    const allowed = await openLabelEmails(m.to_email);
    if (!allowed) {
      await rows(`DELETE FROM mail_queue WHERE id = $1`, [m.id]);
      continue;
    }
    try {
      await mailer.send(m.to_email, m.subject, m.body);
      await rows(`UPDATE mail_queue SET sent_at = $1 WHERE id = $2`, [instantOf(new Date()), m.id]);
    } catch {
      // A mail not yet accepted is tried again on the next pass.
    }
  }
}
