import nodemailer from "nodemailer";
import { config } from "../config.js";

const transport = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: false, tls: { rejectUnauthorized: false } });

export type Mail = { to: string; subject: string; text: string; replyTo?: string };

/** Send mail; returns false when SMTP is unreachable (queued mail is dropped per provider rules). */
export async function sendMail(mail: Mail): Promise<boolean> {
  try {
    await transport.sendMail({ from: config.smtp.from, to: mail.to, subject: mail.subject, text: mail.text, replyTo: mail.replyTo });
    return true;
  } catch {
    return false;
  }
}
