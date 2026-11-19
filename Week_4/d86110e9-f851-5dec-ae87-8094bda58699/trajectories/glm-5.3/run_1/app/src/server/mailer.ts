// Mailpit receives real SMTP from the app. Sign-up, invites and every
// send-email step go through send(); answers success only after acceptance.

import nodemailer from "nodemailer";
import { CONFIG } from "./config.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function transport(): ReturnType<typeof nodemailer.createTransport> {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: CONFIG.smtp.host,
      port: CONFIG.smtp.port,
      secure: false,
      connectionTimeout: 4000,
      socketTimeout: 4000,
      tls: { rejectUnauthorized: false },
    });
  }
  return transporter;
}

export interface MailResult { accepted: boolean; message_id?: string; error?: string }

export async function sendMail(opts: { to: string; subject: string; body: string; headers?: Record<string, string> }): Promise<MailResult> {
  try {
    const info = await transport().sendMail({
      from: CONFIG.mailFrom,
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
      headers: opts.headers,
    });
    if (info.accepted && (info.accepted as unknown[]).length > 0) {
      return { accepted: true, message_id: info.messageId };
    }
    if (info.rejected && (info.rejected as unknown[]).length > 0) {
      return { accepted: false, error: "Mail server did not accept the message" };
    }
    return { accepted: true, message_id: info.messageId };
  } catch (e) {
    return { accepted: false, error: e instanceof Error ? e.message : "Mail server did not accept the message" };
  }
}

export async function mailHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const t = transport();
    t.verify((err) => resolve(!err));
  });
}
