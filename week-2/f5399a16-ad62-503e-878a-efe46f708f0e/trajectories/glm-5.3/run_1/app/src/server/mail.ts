// Mail is sent over SMTP from the MAIL_FROM value through the pending mail in
// Postgres, each message once. A calendar file rides as an attachment with its
// own content type.

import nodemailer from "nodemailer";
import type { Config } from "./config";
import type { Db } from "./db";
import { newId, now } from "./http";

export type PendingMail = {
  id: string;
  to: string;
  subject: string;
  body: string;
  html: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachment: string | null;
};

export async function queueMail(db: Db, mail: Omit<PendingMail, "id">): Promise<void> {
  await db.query(
    "insert into pending_mail (id, to_address, subject, body, html, attachment_name, attachment_type, attachment, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      newId(),
      mail.to,
      mail.subject,
      mail.body,
      mail.html,
      mail.attachmentName,
      mail.attachmentType,
      mail.attachment,
      String(now()),
    ],
  );
}

// Delivers this copy's own pending mail, one message at a time. A failure
// leaves the row in place so a later attempt delivers it, but no copy sends
// another copy's mail, since each runs on its own database.
export async function deliverPending(config: Config, db: Db): Promise<void> {
  const rows = await db.many(
    "select id, to_address, subject, body, html, attachment_name, attachment_type, attachment from pending_mail order by created_at, id",
    [],
  );
  if (rows.length === 0) return;
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    ignoreTLS: true,
  });
  for (const row of rows) {
    const mail = {
      from: config.smtp.from,
      to: String(row.to_address),
      subject: String(row.subject),
      text: String(row.body),
      html: row.html === null ? undefined : String(row.html),
      attachments:
        row.attachment === null
          ? undefined
          : [
              {
                filename: String(row.attachment_name),
                content: Buffer.from(String(row.attachment), "utf8"),
                contentType: String(row.attachment_type),
              },
            ],
    };
    try {
      await transport.sendMail(mail);
      await db.query("delete from pending_mail where id = $1", [String(row.id)]);
    } catch {
      return;
    }
  }
}

