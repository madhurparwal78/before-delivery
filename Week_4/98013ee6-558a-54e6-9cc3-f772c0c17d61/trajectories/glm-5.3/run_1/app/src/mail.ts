import { config } from "./config";
import nodemailer from "nodemailer";

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  ignoreTLS: true,
});

/** Sends an email from MAIL_FROM; failures are logged and never block a reply. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  try {
    await transport.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text: body,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body)}</pre>`,
    });
  } catch (e) {
    console.error("mail send failed", subject, e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
