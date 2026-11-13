import { config } from "../config.js";
import { type Db, pool, tx } from "../db.js";
import { ApiError, StorageError, invalidState, mailUnavailable, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import { reasonProblem } from "./validate.js";
import { reportFailure } from "../health.js";
import { deliverAll, queueMail } from "../mail/outbox.js";
import { composeMail } from "../mail/messages.js";
import { sendMail } from "../mail/smtp.js";
import { buildCompletedPdf, type SealField } from "../pdf/completed.js";
import { completedKey, getObject, originalKey, putObject } from "../storage.js";
import { addSeconds, newToken, sha256Hex } from "../util.js";
import { appendAudit } from "./audit.js";
import {
  type DocumentRow,
  type FieldRow,
  type RecipientRow,
  type UserRow,
  fieldsOf,
  ownerOf,
  recipientsOf,
  touchDocument,
  announce,
} from "./rows.js";
import type { Actor } from "./permissions.js";

function validReason(input: unknown, empty: string): string {
  const problem = reasonProblem(input, empty);
  if (problem) throw validation({ reason: problem });
  return String(input).trim();
}

export interface Effects {
  outbox: string[];
  seal: string | null;
}

const noEffects = (): Effects => ({ outbox: [], seal: null });

export async function runEffects(effects: Effects): Promise<void> {
  await deliverAll(effects.outbox);
  if (effects.seal) await attemptSeal(effects.seal, false);
}

function documentToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function isComplete(field: FieldRow): boolean {
  if (field.value === null) return false;
  return field.kind === "text" ? field.value.trim().length > 0 : true;
}

function incompleteRequired(fields: FieldRow[], recipientId: string): FieldRow[] {
  return fields.filter((f) => f.recipient_id === recipientId && f.required && f.kind !== "date" && !isComplete(f));
}

async function beginTurn(
  db: Db,
  document: DocumentRow,
  recipient: RecipientRow,
  now: Date,
  kind: "invitation" | "new_link",
): Promise<string> {
  const token = newToken();
  await db.query("UPDATE links SET replaced = true WHERE recipient_id = $1", [recipient.id]);
  await db.query("INSERT INTO links (token_hash, recipient_id) VALUES ($1, $2)", [sha256Hex(token), recipient.id]);
  await db.query("UPDATE recipients SET status = 'invited', delivery = NULL, link_expires_at = $2 WHERE id = $1", [
    recipient.id,
    addSeconds(now, config.linkTtlSeconds),
  ]);
  return queueMail(db, { kind, documentId: document.id, recipientId: recipient.id, toEmail: recipient.email, linkToken: token });
}

export async function expireDue(db: Db, documentId?: string): Promise<void> {
  const { rows } = await db.query<{ document_id: string; team_id: string }>(
    `WITH expired AS (
       UPDATE recipients r SET status = 'expired'
       FROM documents d
       WHERE d.id = r.document_id AND d.status = 'in_progress' AND r.status IN ('invited', 'viewed')
         AND r.link_expires_at <= now() AND ($1::uuid IS NULL OR d.id = $1::uuid)
       RETURNING r.document_id
     )
     SELECT DISTINCT e.document_id, d.team_id FROM expired e JOIN documents d ON d.id = e.document_id`,
    [documentId ?? null],
  );
  for (const row of rows) {
    await db.query("UPDATE documents SET version = version + 1, updated_at = now() WHERE id = $1", [row.document_id]);
    await announce(db, { type: "document", documentId: row.document_id, teamId: row.team_id });
  }
}

export async function endReminderCooldowns(): Promise<void> {
  const { rows } = await pool.query<{ id: string; team_id: string }>(
    `UPDATE documents SET reminder_expiry_pushed = true
     WHERE reminder_expiry_pushed = false AND reminder_available_at <= now() RETURNING id, team_id`,
  );
  for (const row of rows) await announce(pool, { type: "document", documentId: row.id, teamId: row.team_id });
}

export async function sendDocument(db: Db, document: DocumentRow, actor: Actor): Promise<Effects> {
  if (document.status !== "draft") throw invalidState(document.status);
  const recipients = await recipientsOf(db, document.id);
  const fields = await fieldsOf(db, document.id);
  if (recipients.length === 0) throw new ApiError(422, { error: "no_recipients" });
  const missing = recipients
    .filter((r) => !fields.some((f) => f.recipient_id === r.id && f.kind === "signature" && f.required))
    .map((r) => r.name);
  if (missing.length > 0) throw new ApiError(422, { error: "missing_signature_fields", recipients: missing });
  const now = new Date();
  await db.query("UPDATE documents SET status = 'in_progress', current_order = 1 WHERE id = $1", [document.id]);
  await appendAudit(db, document.id, "document.sent", actor.email, null);
  const first = recipients[0];
  const outbox = first ? [await beginTurn(db, document, first, now, "invitation")] : [];
  await touchDocument(db, document);
  return { outbox, seal: null };
}

export async function markViewed(db: Db, document: DocumentRow, recipient: RecipientRow): Promise<void> {
  if (recipient.status !== "invited") return;
  await db.query("UPDATE recipients SET status = 'viewed' WHERE id = $1", [recipient.id]);
  await appendAudit(db, document.id, "recipient.viewed", recipient.email, recipient.id);
  await touchDocument(db, document);
}

export async function signRecipient(db: Db, document: DocumentRow, recipient: RecipientRow): Promise<Effects> {
  const fields = await fieldsOf(db, document.id);
  const remaining = incompleteRequired(fields, recipient.id).length;
  if (remaining > 0) throw new ApiError(422, { error: "incomplete_fields", remaining });
  const now = new Date();
  await db.query("UPDATE fields SET value = $2 WHERE document_id = $1 AND recipient_id = $3 AND kind = 'date'", [
    document.id,
    documentToday(now, document.time_zone),
    recipient.id,
  ]);
  await db.query("UPDATE recipients SET status = 'signed', signed_at = $2 WHERE id = $1", [recipient.id, now]);
  await appendAudit(db, document.id, "recipient.signed", recipient.email, recipient.id);
  const recipients = await recipientsOf(db, document.id);
  const following = recipients.find((r) => r.signing_order === recipient.signing_order + 1);
  const effects = noEffects();
  if (following) {
    await db.query("UPDATE documents SET current_order = $2 WHERE id = $1", [document.id, following.signing_order]);
    effects.outbox.push(await beginTurn(db, document, following, now, "invitation"));
  } else {
    await db.query("UPDATE documents SET status = 'sealing', current_order = NULL, seal_next_attempt_at = now() WHERE id = $1", [document.id]);
    effects.seal = document.id;
  }
  await touchDocument(db, document);
  return effects;
}

async function queueNotices(
  db: Db,
  document: DocumentRow,
  kind: "decline_notice" | "void_notice",
  addresses: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const email of addresses) {
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    ids.push(await queueMail(db, { kind, documentId: document.id, recipientId: null, toEmail: email, linkToken: null }));
  }
  return ids;
}

export async function declineDocument(db: Db, document: DocumentRow, recipient: RecipientRow, reasonInput: unknown): Promise<Effects> {
  const reason = validReason(reasonInput, VALIDATION_COPY.reasonDecline);
  const recipients = await recipientsOf(db, document.id);
  const owner = await ownerOf(db, document.owner_id);
  await db.query("UPDATE recipients SET status = 'declined', decline_reason = $2 WHERE id = $1", [recipient.id, reason]);
  await db.query("UPDATE documents SET status = 'declined', current_order = NULL WHERE id = $1", [document.id]);
  await appendAudit(db, document.id, "recipient.declined", recipient.email, recipient.id);
  const signed = recipients.filter((r) => r.status === "signed").map((r) => r.email);
  const outbox = await queueNotices(db, document, "decline_notice", [owner.email, ...signed]);
  await touchDocument(db, document);
  return { outbox, seal: null };
}

export async function voidDocument(db: Db, document: DocumentRow, actor: Actor, reasonInput: unknown): Promise<Effects> {
  if (document.status !== "in_progress") throw invalidState(document.status);
  const reason = validReason(reasonInput, VALIDATION_COPY.reasonVoid);
  const recipients = await recipientsOf(db, document.id);
  const owner = await ownerOf(db, document.owner_id);
  await db.query("UPDATE documents SET status = 'voided', current_order = NULL, voided_by = $2, void_reason = $3 WHERE id = $1", [
    document.id,
    actor.id,
    reason,
  ]);
  await appendAudit(db, document.id, "document.voided", actor.email, null);
  const signed = recipients.filter((r) => r.status === "signed").map((r) => r.email);
  const current = recipients.filter((r) => r.signing_order === document.current_order).map((r) => r.email);
  const outbox = await queueNotices(db, document, "void_notice", [owner.email, ...signed, ...current]);
  await touchDocument(db, document);
  return { outbox, seal: null };
}

export async function issueNewLink(db: Db, document: DocumentRow, recipient: RecipientRow, actor: Actor): Promise<Effects> {
  if (document.status !== "in_progress") throw invalidState(document.status);
  if (recipient.status !== "expired") throw invalidState(recipient.status);
  const outbox = await beginTurn(db, document, recipient, new Date(), "new_link");
  await appendAudit(db, document.id, "link.resent", actor.email, recipient.id);
  await touchDocument(db, document);
  return { outbox: [outbox], seal: null };
}

export async function remindRecipient(db: Db, document: DocumentRow, actor: Actor): Promise<Date> {
  if (document.status !== "in_progress") throw invalidState(document.status);
  const recipients = await recipientsOf(db, document.id);
  const current = recipients.find((r) => r.signing_order === document.current_order);
  if (!current || (current.status !== "invited" && current.status !== "viewed")) throw invalidState(current?.status ?? document.status);
  const now = new Date();
  if (document.reminder_available_at && document.reminder_available_at > now) {
    throw new ApiError(429, { error: "reminder_cooldown", availableAt: document.reminder_available_at.toISOString() });
  }
  const owner = await ownerOf(db, document.owner_id);
  const token = newToken();
  await db.query("INSERT INTO links (token_hash, recipient_id) VALUES ($1, $2)", [sha256Hex(token), current.id]);
  try {
    await sendMail(
      composeMail({
        kind: "reminder",
        toEmail: current.email,
        title: document.title,
        senderName: owner.name,
        linkToken: token,
        reason: null,
        actorName: null,
        completedSha256: null,
        downloadPath: null,
      }),
    );
  } catch {
    reportFailure("mail");
    throw mailUnavailable();
  }
  const availableAt = addSeconds(now, config.reminderCooldownSeconds);
  await db.query("UPDATE documents SET reminder_available_at = $2, reminder_expiry_pushed = false WHERE id = $1", [document.id, availableAt]);
  await appendAudit(db, document.id, "reminder.sent", actor.email, current.id);
  await touchDocument(db, document);
  return availableAt;
}

async function completedCopies(db: Db, document: DocumentRow, recipients: RecipientRow[], owner: UserRow): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (seen.has(recipient.email.toLowerCase())) continue;
    seen.add(recipient.email.toLowerCase());
    const token = newToken();
    await db.query("INSERT INTO links (token_hash, recipient_id, replaced) VALUES ($1, $2, false)", [sha256Hex(token), recipient.id]);
    ids.push(await queueMail(db, { kind: "completed", documentId: document.id, recipientId: recipient.id, toEmail: recipient.email, linkToken: token }));
  }
  if (!seen.has(owner.email.toLowerCase())) {
    ids.push(await queueMail(db, { kind: "completed", documentId: document.id, recipientId: null, toEmail: owner.email, linkToken: null }));
  }
  return ids;
}

async function attemptSeal(documentId: string, onlyWhenDue: boolean): Promise<void> {
  const mails = await tx(async (client) => {
    const { rows } = await client.query<DocumentRow>(
      `SELECT * FROM documents WHERE id = $1 AND status = 'sealing' ${onlyWhenDue ? "AND seal_next_attempt_at <= now()" : ""}
       FOR UPDATE SKIP LOCKED`,
      [documentId],
    );
    const document = rows[0];
    if (!document) return [];
    const recipients = await recipientsOf(client, document.id);
    const owner = await ownerOf(client, document.owner_id);
    const fields = await fieldsOf(client, document.id);
    const { rows: heads } = await client.query<{ hash: string }>(
      "SELECT hash FROM audit_events WHERE document_id = $1 AND type = 'recipient.signed' ORDER BY seq DESC LIMIT 1",
      [document.id],
    );
    const seal: SealField[] = fields.map((f) => ({ kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value, strokes: f.strokes }));
    let pdf: Buffer;
    try {
      const original = await getObject(originalKey(document.id));
      pdf = buildCompletedPdf(original, seal, {
        title: document.title,
        documentId: document.id,
        originalSha256: document.original_sha256,
        pageCount: document.page_count,
        signers: recipients.map((r) => ({ order: r.signing_order, name: r.name, email: r.email, signedAt: r.signed_at ?? new Date() })),
        chainHead: heads[0]?.hash ?? "",
      });
      await putObject(completedKey(document.id), pdf);
    } catch (error) {
      if (!(error instanceof StorageError)) console.error("sealing failed", error);
      reportFailure("storage");
      await client.query("UPDATE documents SET seal_next_attempt_at = now() + make_interval(secs => $2) WHERE id = $1", [
        document.id,
        config.sealRetrySeconds,
      ]);
      return [];
    }
    await appendAudit(client, document.id, "document.sealed", "system", null);
    await client.query("UPDATE documents SET status = 'completed', completed_sha256 = $2, seal_next_attempt_at = NULL WHERE id = $1", [
      document.id,
      sha256Hex(pdf),
    ]);
    await appendAudit(client, document.id, "document.completed", "system", null);
    const queued = await completedCopies(client, document, recipients, owner);
    await touchDocument(client, document);
    return queued;
  });
  await deliverAll(mails);
}

export async function sealDue(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM documents WHERE status = 'sealing' AND seal_next_attempt_at <= now() LIMIT 10",
  );
  for (const { id } of rows) await attemptSeal(id, true);
}

