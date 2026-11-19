import nodemailer from "nodemailer";
import { config } from "../config.ts";
import { pool, query, type Queryable } from "../db/pool.ts";

const LINE_BREAKS = /[\r\n\u0085\u2028\u2029]+/g;

/** Each run of line breaks reads as one space, so a header value can never add a header. */
export function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, " ");
}

interface OutgoingMail {
  clientId?: string;
  to: string;
  replyTo?: string;
  subject: string;
  body: string;
}

/** Mail waits in the outbox, so it survives a restart and each copy delivers its own. */
export async function queueMail(mail: OutgoingMail, on: Queryable = pool): Promise<void> {
  await query(
    "INSERT INTO mail_outbox (client_id, to_address, reply_to, subject, body) VALUES ($1, $2, $3, $4, $5)",
    [mail.clientId ?? null, mail.to, mail.replyTo ?? null, oneLine(mail.subject), mail.body],
    on,
  );
}

const transport = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: false, ignoreTLS: true });

export async function deliver(mail: { to: string; replyTo: string | null; subject: string; body: string }): Promise<void> {
  await transport.sendMail({
    from: config.mailFrom,
    to: mail.to,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    text: mail.body,
  });
}
