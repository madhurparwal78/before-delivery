import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";
import type { Sql } from "./db.js";

// Every outbound email is queued first and delivered exactly once when the
// mail server is reachable. A message cancelled before sending is never
// delivered. Each email is a separate message with exactly one To recipient.
export type MailKind = "embargo_lift" | "licence_receipt" | "expiry_warning" | "takedown_notice";

const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export class Mailer {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: AppConfig) {}

  private transport(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5000,
        socketTimeout: 5000,
      });
    }
    return this.transporter;
  }

  async queue(sql: Sql, row: {
    kind: MailKind;
    to: string;
    subject: string;
    body: string;
    essayId?: string | null;
    licenceId?: string | null;
  }): Promise<void> {
    await sql`
      INSERT INTO mail_queue (kind, to_email, subject, subject_ascii, body, essay_id, licence_id)
      VALUES (${row.kind}, ${row.to}, ${row.subject}, ${isPrintableAscii(row.subject)}, ${row.body},
              ${row.essayId ?? null}, ${row.licenceId ?? null})
      ON CONFLICT (kind, to_email, licence_id) DO NOTHING
    `;
  }

  // Send as many queued messages as possible. Each message is claimed in the
  // database before sending, so with several instances sharing one database
  // each email is delivered exactly once.
  async drain(sql: Sql, limit = 20): Promise<void> {
    const claimed = await sql`
      UPDATE mail_queue SET status = 'sending', claimed_at = now(), claimed_by = ${INSTANCE_ID}
      WHERE id IN (
        SELECT id FROM mail_queue
        WHERE status = 'queued' AND next_attempt_at <= now()
        ORDER BY id LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) RETURNING id, to_email, subject, subject_ascii, body`;
    if (claimed.length === 0) return;
    for (const mail of claimed) {
      let ok = false;
      try {
        const subject = mail.subject_ascii ? mail.subject : encodeSubjectWords(mail.subject);
        await this.transport().sendMail({
          from: this.config.smtp.from,
          to: mail.to_email,
          subject,
          text: mail.body,
        });
        ok = true;
      } catch {
        ok = false;
      }
      if (ok) {
        await sql`UPDATE mail_queue SET status = 'sent', sent_at = now() WHERE id = ${mail.id} AND status = 'sending'`;
      } else {
        await sql`UPDATE mail_queue SET status = 'queued', attempts = attempts + 1,
                  next_attempt_at = now() + interval '5 seconds' WHERE id = ${mail.id} AND status = 'sending'`;
      }
    }
  }

  async cancelEssayMail(sql: Sql, essayId: string): Promise<void> {
    await sql`UPDATE mail_queue SET status = 'cancelled'
              WHERE essay_id = ${essayId} AND status IN ('queued', 'sending')`;
  }
}

// A subject is sent as plain text only when it is entirely printable ASCII and
// contains no "=?" ; otherwise the whole subject is sent as UTF-8 MIME
// encoded-words (RFC 2047), folded per RFC 5322. Either way the decoded
// subject equals the published subject byte for byte.
export function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c > 0x7e) return false;
    if (text.startsWith("=?", i)) return false;
  }
  return true;
}

export function encodeSubjectWords(text: string): string {
  const words: string[] = [];
  const bytes = Buffer.from(text, "utf8");
  // Each encoded word carries a chunk of at most 45 payload bytes.
  let i = 0;
  while (i < bytes.length) {
    const chunkEnd = Math.min(bytes.length, i + 45);
    let end = chunkEnd;
    // Never split a multi-byte sequence.
    while (end > i && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    const chunk = bytes.subarray(i, end);
    words.push(`=?UTF-8?B?${chunk.toString("base64")}?=`);
    i = end;
  }
  return foldHeader(words.join(" "));
}

function foldHeader(value: string): string {
  const lines: string[] = [];
  let current = "";
  for (const part of value.split(" ")) {
    if (current.length === 0) current = part;
    else if (current.length + part.length + 1 <= 76) current += " " + part;
    else {
      lines.push(current);
      current = part;
    }
  }
  if (current) lines.push(current);
  return lines.join("\r\n ");
}
