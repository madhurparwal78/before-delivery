import { randomUUID, createHash } from "node:crypto";
import { type PoolClient } from "pg";
import { type Ctx } from "./core.js";
import { writeAudit } from "./audit.js";
import { type MailKind } from "./mail.js";
import type { Recipient } from "./domain.js";

/** Email sending, holding and retry bookkeeping lives here. */

export interface OutgoingMail {
  kind: MailKind;
  to: string;
  subject: string;
  body: string;
  documentId: string | null;
  senderName: string | null;
}

/** Try to deliver now; if it fails, record a held email row. */
export async function deliver(ctx: Ctx, mail: OutgoingMail): Promise<"sent" | "held"> {
  const ok = await trySend(ctx, mail);
  if (ok) return "sent";
  await ctx.pool.query(
    `INSERT INTO held_emails (id, document_id, to_email, subject, body, from_name, from_address, kind, public_url, held_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [randomUUID(), mail.documentId, mail.to, mail.subject, mail.body, ctx.cfg.mailFrom.name, ctx.cfg.mailFrom.address, mail.kind, ctx.cfg.publicUrl],
  );
  return "held";
}

async function trySend(ctx: Ctx, mail: OutgoingMail): Promise<boolean> {
  const via = mail.senderName !== null && ["invite", "reminder", "new_link"].includes(mail.kind);
  const fromName = sanitize(via ? `${mail.senderName} via Undersign` : ctx.cfg.mailFrom.name);
  try {
    await ctx.mailer.transporter.sendMail({
      from: `"${fromName}" <${ctx.cfg.mailFrom.address}>`,
      to: mail.to,
      subject: sanitize(mail.subject),
      text: mail.body,
    });
    return true;
  } catch {
    return false;
  }
}

function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** For held invite/new-link: writes invite.sent or invite.held inside the transaction. */
export async function recordInviteOutcome(
  client: PoolClient,
  documentId: string,
  recipient: Recipient,
  outcome: "sent" | "held",
  actorEmail: string,
  at: Date,
): Promise<void> {
  await writeAudit(client, documentId, outcome === "sent" ? "invite.sent" : "invite.held", "system", recipient.id, at);
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
