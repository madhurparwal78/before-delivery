import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { auditChainHead } from "./audit.js";

export { auditChainHead };

/** One place that flattens any run of CR/LF to a single space. */
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export type MailKind = "invite" | "reminder" | "new_link" | "decline_notice" | "void_notice" | "completed";
export const VIA_KINDS: MailKind[] = ["invite", "reminder", "new_link"];

export interface MailMessage {
  kind: MailKind;
  to: string;
  subject: string;
  body: string;
}

export interface SmtpConfig { host: string; port: number }
export interface FromConfig { name: string; address: string }

export async function sendNow(deps: { transporter: Transporter; from: FromConfig }, msg: MailMessage, senderName: string | null): Promise<boolean> {
  const via = senderName !== null && VIA_KINDS.includes(msg.kind);
  const fromName = sanitizeHeader(via ? `${senderName} via Undersign` : deps.from.name);
  try {
    await deps.transporter.sendMail({
      from: `"${fromName}" <${deps.from.address}>`,
      to: msg.to,
      subject: sanitizeHeader(msg.subject),
      text: msg.body,
    });
    return true;
  } catch {
    return false;
  }
}

export class Mailer {
  transporter: Transporter;
  from: FromConfig;
  smtp: SmtpConfig;
  ok: boolean;

  constructor(cfg: { smtp: SmtpConfig; mailFrom: FromConfig }) {
    this.smtp = cfg.smtp;
    this.from = cfg.mailFrom;
    this.transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: false,
      connectionTimeout: 2500,
      greetingTimeout: 2500,
      socketTimeout: 4000,
      disableFileAccess: true,
    });
    this.ok = false;
  }

  async check(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.ok = true;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }
}

