// Certificates on file: liability insurance and crew food handler cards, their review states,
// the coverage rule and the expiry warnings.

import { randomUUID } from "node:crypto";
import type { CertificateDocument, DocumentKind, DocumentStatus } from "../shared/api.js";
import { isCalendarDate } from "../shared/zone.js";
import { nowSecond } from "./clock.js";
import { tx, type Db } from "./db.js";
import { ApiError, conflict, FieldErrors, forbidden, invalid, notFound, unavailable } from "./errors.js";
import { json, type Reply, type Request } from "./http.js";
import { iso, isoOrNull, today } from "./kitchen.js";
import { enqueueMail, kickMail } from "./mail.js";
import type { SessionUser } from "./sessions.js";
import { getObject, putObject } from "./storage.js";

interface DocumentRow {
  id: string;
  member_id: string;
  kind: DocumentKind;
  crew_cook_id: string | null;
  crew_cook_name: string | null;
  expires_on: string;
  status: "uploaded" | "approved" | "rejected";
  filename: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  uploaded_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.member_id, d.kind, d.crew_cook_id, u.name AS crew_cook_name, d.expires_on, d.status, d.filename,
         d.content_type, d.size_bytes, d.object_key, d.uploaded_at, d.reviewed_at, d.rejection_reason
    FROM documents d LEFT JOIN users u ON u.id = d.crew_cook_id`;

/**
 * Document coverage: a document is valid through 23:59:59 kitchen time on its expires_on date, so it covers
 * every kitchen date on or before expires_on and no date after it.
 */
function coversDate(expiresOn: string, kitchenDate: string): boolean {
  return kitchenDate <= expiresOn;
}

/** An approved document reads expired once its validity has ended. */
function readStatus(row: DocumentRow, kitchenToday: string): DocumentStatus {
  return row.status === "approved" && !coversDate(row.expires_on, kitchenToday) ? "expired" : row.status;
}

function documentJson(row: DocumentRow): CertificateDocument {
  return {
    id: row.id,
    member_id: row.member_id,
    kind: row.kind,
    crew_cook_id: row.crew_cook_id,
    crew_cook_name: row.crew_cook_name,
    expires_on: row.expires_on,
    status: readStatus(row, today()),
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: iso(row.uploaded_at),
    reviewed_at: isoOrNull(row.reviewed_at),
    rejection_reason: row.rejection_reason,
  };
}

async function documentRow(db: Db, id: string, lock = false): Promise<DocumentRow | null> {
  const found = await db.query<DocumentRow>(`${DOCUMENT_SELECT} WHERE d.id = $1${lock ? " FOR UPDATE OF d" : ""}`, [id]);
  return found.rows[0] ?? null;
}

interface DocumentScope {
  memberId?: string;
  crewCookId?: string;
  status?: DocumentStatus;
}

async function listDocuments(db: Db, scope: DocumentScope): Promise<CertificateDocument[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope.memberId) {
    params.push(scope.memberId);
    where.push(`d.member_id = $${params.length}`);
  }
  if (scope.crewCookId) {
    params.push(scope.crewCookId);
    where.push(`d.crew_cook_id = $${params.length}`);
  }
  const found = await db.query<DocumentRow>(`${DOCUMENT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY d.uploaded_at, d.id`, params);
  const kitchenToday = today();
  return found.rows.filter((row) => !scope.status || readStatus(row, kitchenToday) === scope.status).map(documentJson);
}

interface Coverage {
  documentId: string;
  expiresOn: string;
}

/** The member's liability insurance for the members list: a currently covering one first, else the latest upload. */
export async function insuranceSummary(db: Db, memberId: string): Promise<{ status: DocumentStatus; expires_on: string } | null> {
  const found = await db.query<DocumentRow>(`${DOCUMENT_SELECT} WHERE d.member_id = $1 AND d.kind = 'liability_insurance' ORDER BY d.uploaded_at DESC, d.id`, [memberId]);
  const kitchenToday = today();
  const covering = found.rows.find((row) => readStatus(row, kitchenToday) === "approved");
  const shown = covering ?? found.rows[0];
  return shown ? { status: readStatus(shown, kitchenToday), expires_on: shown.expires_on } : null;
}

/** The approved document of the right kind that covers a booking date, if any; any one such document is enough. */
export async function coveringDocument(db: Db, memberId: string, kind: DocumentKind, crewCookId: string | null, bookingDate: string): Promise<Coverage | null> {
  const found = await db.query<{ id: string; expires_on: string }>(
    `SELECT id, expires_on FROM documents
      WHERE member_id = $1 AND kind = $2 AND crew_cook_id IS NOT DISTINCT FROM $3 AND status = 'approved'
      ORDER BY expires_on DESC, id`,
    [memberId, kind, crewCookId],
  );
  const row = found.rows.find((doc) => coversDate(doc.expires_on, bookingDate));
  return row ? { documentId: row.id, expiresOn: row.expires_on } : null;
}

async function insertDocument(
  db: Db,
  doc: { id: string; memberId: string; kind: DocumentKind; crewCookId: string | null; expiresOn: string; filename: string; contentType: string; size: number; objectKey: string; at: number },
): Promise<void> {
  await db.query(
    `INSERT INTO documents (id, member_id, kind, crew_cook_id, expires_on, status, filename, content_type, size_bytes, object_key, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, 'uploaded', $6, $7, $8, $9, $10)`,
    [doc.id, doc.memberId, doc.kind, doc.crewCookId, doc.expiresOn, doc.filename, doc.contentType, doc.size, doc.objectKey, new Date(doc.at)],
  );
}

function newDocumentId(): string {
  return `doc_${randomUUID().replaceAll("-", "")}`;
}

/** uploaded → approved or rejected, once. Returns false when the document is in any other state. */
async function review(db: Db, id: string, decision: "approved" | "rejected", at: number, reason: string | null): Promise<boolean> {
  const updated = await db.query("UPDATE documents SET status = $2, reviewed_at = $3, rejection_reason = $4 WHERE id = $1 AND status = 'uploaded'", [
    id,
    decision,
    new Date(at),
    reason,
  ]);
  return updated.rowCount === 1;
}

/**
 * Expiry warnings, judged on the kitchen's today: one 14-day warning while today is in
 * [expires_on − 14, expires_on − 3) and one 3-day warning while today is in [expires_on − 3, expires_on].
 * The warning row's primary key makes each (document, threshold) go out once.
 */
export async function queueExpiryWarnings(db: Db): Promise<number> {
  const kitchenToday = today();
  const due = await db.query<{ id: string; days_before: number; contact_email: string }>(
    `WITH due AS (
       SELECT d.id, CASE WHEN $1::date >= d.expires_on - 3 THEN 3 ELSE 14 END AS days_before
         FROM documents d
        WHERE d.status = 'approved' AND $1::date <= d.expires_on AND $1::date >= d.expires_on - 14
     ), fresh AS (
       INSERT INTO document_warnings (document_id, days_before) SELECT id, days_before FROM due
       ON CONFLICT DO NOTHING RETURNING document_id, days_before
     )
     SELECT f.document_id AS id, f.days_before, m.contact_email
       FROM fresh f JOIN documents d ON d.id = f.document_id JOIN members m ON m.id = d.member_id`,
    [kitchenToday],
  );
  for (const row of due.rows) {
    await enqueueMail(db, "expiry_warning", `warning:${row.id}:${row.days_before}`, `${row.id}|${row.days_before}`, row.contact_email);
  }
  return due.rows.length;
}

const FILENAME_MAX = 120;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The file's type judged by its first bytes only. */
function detectType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function validFilename(name: string): boolean {
  return name.length > 0 && name.length <= FILENAME_MAX && !/[/\\]|\.\.|[\x00-\x1f\x7f]/.test(name);
}

async function crewCookOf(db: Db, memberId: string, crewCookId: string): Promise<boolean> {
  const found = await db.query("SELECT 1 FROM users WHERE id = $1 AND role = 'crew_cook' AND member_id = $2", [crewCookId, memberId]);
  return found.rowCount === 1;
}

export async function uploadDocument(req: Request, user: SessionUser): Promise<Reply> {
  if (user.role === "operator" || !user.memberId) throw forbidden();
  const memberId = user.memberId;
  const fields = req.fields;
  const requestedCrew = (fields.crew_cook_id ?? "").trim();
  if (user.role === "crew_cook" && (fields.kind !== "food_handler_card" || (requestedCrew !== "" && requestedCrew !== user.id))) throw forbidden();
  const errors = new FieldErrors();
  const kind: DocumentKind | null = fields.kind === "liability_insurance" || fields.kind === "food_handler_card" ? fields.kind : null;
  if (!kind) errors.add("kind", "invalid");
  const expiresOn = fields.expires_on ?? "";
  if (!isCalendarDate(expiresOn)) errors.add("expires_on", "invalid");
  else if (expiresOn < today()) errors.add("expires_on", "already_expired");
  const crewCookId = user.role === "crew_cook" ? user.id : requestedCrew || null;
  const file = req.file;
  if (!file) errors.add("file", "required");
  else if (file.bytes.length === 0) errors.add("file", "empty");
  else if (!validFilename(file.filename)) errors.add("file", "invalid_filename");
  await tx(async (db) => {
    if (kind === "food_handler_card" && user.role === "member") {
      if (!crewCookId) errors.add("crew_cook_id", "required");
      else if (!(await crewCookOf(db, memberId, crewCookId))) errors.add("crew_cook_id", "unknown");
    }
    if (kind === "liability_insurance" && crewCookId) errors.add("crew_cook_id", "not_allowed");
  });
  if (!kind || !file || errors.any()) throw errors.error();
  if (file.tooLarge) throw new ApiError(413, { error: "file_too_large" });
  const contentType = detectType(file.bytes);
  if (!contentType) throw new ApiError(415, { error: "unsupported_file_type" });
  const id = newDocumentId();
  const objectKey = `documents/${memberId}/${id}`;
  await putObject(objectKey, file.bytes, contentType);
  const document = await tx(async (db) => {
    await insertDocument(db, {
      id,
      memberId,
      kind,
      crewCookId: kind === "food_handler_card" ? crewCookId : null,
      expiresOn,
      filename: file.filename,
      contentType,
      size: file.bytes.length,
      objectKey,
      at: nowSecond(),
    });
    const row = await documentRow(db, id);
    return row ? documentJson(row) : null;
  });
  return json(201, { document });
}

/** Members read their own member's documents; crew cooks read only their own cards; the operator reads all. */
function canRead(user: SessionUser, row: DocumentRow): boolean {
  if (user.role === "operator") return true;
  if (user.role === "crew_cook") return row.crew_cook_id === user.id;
  return row.member_id === user.memberId;
}

async function readableDocument(db: Db, id: string, user: SessionUser): Promise<DocumentRow> {
  const row = await documentRow(db, id);
  if (!row || !canRead(user, row)) throw notFound();
  return row;
}

const STATUS_FILTERS: DocumentStatus[] = ["uploaded", "approved", "rejected", "expired"];

export async function listDocumentsFor(req: Request, user: SessionUser): Promise<Reply> {
  const status = req.query.get("status");
  const filter = STATUS_FILTERS.find((s) => s === status);
  if (status !== null && !filter) throw invalid({ status: "invalid" });
  const scope: DocumentScope = { status: filter };
  if (user.role === "member" && user.memberId) scope.memberId = user.memberId;
  if (user.role === "crew_cook") scope.crewCookId = user.id;
  const documents = await tx((db) => listDocuments(db, scope));
  return json(200, { documents });
}

export async function getDocument(req: Request, user: SessionUser): Promise<Reply> {
  const row = await tx((db) => readableDocument(db, req.params.id, user));
  return json(200, { document: documentJson(row) });
}

function attachmentName(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function documentFile(req: Request, user: SessionUser): Promise<Reply> {
  const row = await tx((db) => readableDocument(db, req.params.id, user));
  const bytes = await getObject(row.object_key);
  if (!bytes) throw unavailable("storage_unavailable");
  return { status: 200, bytes, headers: inertDownload(row.content_type, attachmentName(row.filename)) };
}

/** Stored files are only ever downloads: attachment, the detected type, nosniff and a sandbox CSP. */
export function inertDownload(contentType: string, disposition: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store",
  };
}

async function reviewable(db: Db, id: string, user: SessionUser): Promise<DocumentRow> {
  const row = await documentRow(db, id, true);
  if (!row || (user.role !== "operator" && row.member_id !== user.memberId)) throw notFound();
  if (user.role !== "operator") throw forbidden();
  return row;
}

export async function approveDocument(req: Request, user: SessionUser): Promise<Reply> {
  const document = await tx(async (db) => {
    const row = await reviewable(db, req.params.id, user);
    if (!(await review(db, row.id, "approved", nowSecond(), null))) throw conflict("invalid_transition");
    await queueExpiryWarnings(db);
    const fresh = await documentRow(db, row.id);
    return fresh ? documentJson(fresh) : null;
  });
  kickMail();
  return json(200, { document });
}

export async function rejectDocument(req: Request, user: SessionUser): Promise<Reply> {
  const document = await tx(async (db) => {
    const row = await reviewable(db, req.params.id, user);
    const reason = typeof req.json.reason === "string" ? req.json.reason.trim() : "";
    if (reason.length < 1 || reason.length > 200) throw invalid({ reason: "length" });
    if (!(await review(db, row.id, "rejected", nowSecond(), reason))) throw conflict("invalid_transition");
    const fresh = await documentRow(db, row.id);
    return fresh ? documentJson(fresh) : null;
  });
  return json(200, { document });
}
