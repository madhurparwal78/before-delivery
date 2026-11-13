import type { PoolClient } from "pg";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { scrypt as _scrypt, randomBytes as _rb } from "node:crypto";
import { promisify } from "node:util";
import type { Ctx } from "./core.js";
import { docRow, recipientRow, fieldRow, err, withTransaction, nextStepText, linkIsExpired } from "./core.js";

import { sendNow, type MailKind } from "./mail.js";
import type { DocumentRow, Recipient, Field } from "./domain.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function now(): Date { return new Date(); }

/* ---------- password hashing ---------- */
const scrypt = promisify(_scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = _rb(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/* ---------- tokens ---------- */

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

/* ---------- document fetch helpers ---------- */

export async function getDocument(ctx: Ctx, id: string, opts: { forUpdate?: boolean } = {}): Promise<DocumentRow> {
  if (!UUID_RE.test(id)) throw err(404, "not_found");
  const q = opts.forUpdate
    ? "SELECT * FROM documents WHERE id = $1 FOR UPDATE"
    : "SELECT * FROM documents WHERE id = $1";
  const res = await ctx.pool.query(q, [id]);
  if (res.rowCount === 0) throw err(404, "not_found");
  const doc = docRow(res.rows[0]);
  if (ctx.actor && doc.teamId !== ctx.actor.teamId) throw err(404, "not_found");
  return doc;
}

export async function getDocumentForUpdate(client: PoolClient, id: string): Promise<DocumentRow> {
  const res = await client.query("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [id]);
  if (res.rowCount === 0) throw err(404, "not_found");
  return docRow(res.rows[0]);
}

export async function getRecipients(client: { query: Function }, documentId: string): Promise<Recipient[]> {
  const res = await client.query('SELECT * FROM recipients WHERE document_id = $1 ORDER BY "order"', [documentId]);
  return res.rows.map(recipientRow);
}

export async function getFields(client: { query: Function }, documentId: string): Promise<Field[]> {
  const res = await client.query("SELECT * FROM fields WHERE document_id = $1 ORDER BY created_at, id", [documentId]);
  return res.rows.map(fieldRow);
}

/* ---------- document JSON ---------- */

export function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function documentJson(
  doc: DocumentRow,
  recipients: Recipient[],
  fields: Field[],
): Record<string, unknown> {

  return {
    id: doc.id,
    title: doc.title,
    status: doc.status,
    teamId: doc.teamId,
    ownerId: doc.ownerId,
    timeZone: doc.timeZone,
    pageCount: doc.pageCount,
    originalSha256: doc.originalSha256,
    completedSha256: doc.completedSha256,
    version: doc.version,
    currentOrder: doc.currentOrder,
    reminderAvailableAt: toIso(doc.reminderAvailableAt),
    recipients: recipients.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      order: r.order,
      status: r.status,
      delivery: r.delivery,
      linkExpiresAt: toIso(r.linkExpiresAt),
      signedAt: toIso(r.signedAt),
      declineReason: r.declineReason,
      binding: r.binding,
    })),
    fields: fields.map((f) => ({
      id: f.id,
      recipientId: f.recipientId,
      kind: f.kind,
      label: f.label,
      required: f.required,
      page: f.page,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      value: f.value,
    })),
  };
}

export interface DocumentExtras {
  nextStep: string;
  updatedAt: string;
}

export async function loadDocumentBundle(ctx: Ctx, id: string): Promise<{ doc: DocumentRow; recipients: Recipient[]; fields: Field[]; nextStep: string }> {
  const doc = await getDocument(ctx, id);
  const recipients = await getRecipients(ctx.pool, doc.id);
  const fields = await getFields(ctx.pool, doc.id);
  return {
    doc,
    recipients,
    fields,
    nextStep: nextStepText({
      status: doc.status,
      currentOrder: doc.currentOrder,
      recipientCount: recipients.length,
      currentRecipient: currentRecipientOf(doc, recipients),
    }),
  };
}

export function currentRecipientOf(doc: DocumentRow, recipients: Recipient[]): { name: string; status: Recipient["status"]; delivery: Recipient["delivery"] } | null {
  if (doc.currentOrder === null) return null;
  const r = recipients.find((x) => x.order === doc.currentOrder);
  if (!r) return null;
  return { name: r.name, status: r.status, delivery: r.delivery };
}

export function effectiveRecipientStatus(r: Recipient, doc: DocumentRow, nowDate: Date): Recipient["status"] {
  if (doc.status === "in_progress" && (r.status === "invited" || r.status === "viewed") && linkIsExpired(r, nowDate)) {
    return "expired";
  }
  return r.status;
}

/* ---------- emails ---------- */

export interface SendInviteArgs {
  ctx: Ctx;
  client: PoolClient;
  documentId: string;
  title: string;
  senderName: string;
  recipient: Recipient;
  token: string;
  kind: "invite" | "reminder" | "new_link";
}

export async function deliverOrHold(ctx: Ctx, msg: { kind: MailKind; to: string; subject: string; body: string }, extra: { documentId: string | null; senderName: string | null; onSent?: (client: PoolClient) => Promise<void>; onHeld?: (client: PoolClient) => Promise<void> }): Promise<"sent" | "held"> {
  const ok = await sendNow({ transporter: ctx.mailer.transporter, from: ctx.cfg.mailFrom }, msg, extra.senderName);
  if (ok) {
    if (extra.onSent) await withTransaction(ctx.pool, extra.onSent);
    return "sent";
  } else {
    await ctx.pool.query(
      `INSERT INTO held_emails (document_id, to_email, subject, body, from_name, from_address, kind, held_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [extra.documentId, msg.to, msg.subject, msg.body, ctx.cfg.mailFrom.name, ctx.cfg.mailFrom.address, msg.kind],
    );
    if (extra.onHeld) await withTransaction(ctx.pool, extra.onHeld);
    return "held";
  }
}

export async function inviteEmail(ctx: Ctx, doc: DocumentRow, recipient: Recipient, token: string, kind: "invite" | "reminder" | "new_link", senderName: string): Promise<{ subject: string; body: string }> {
  const link = `${ctx.cfg.publicUrl}/sign/${token}`;
  const subject =
    kind === "invite" ? `Please sign: ${doc.title}` :
    kind === "reminder" ? `Reminder: please sign ${doc.title}` :
    `New link: ${doc.title}`;
  const body = `Open the document: ${link}`;
  return { subject, body };
}
