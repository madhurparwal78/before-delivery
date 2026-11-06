// Member documents: upload checks, approval, expiry status, the current document per type, expiry
// notices and safe delivery.

import { randomBytes } from "node:crypto";
import type pg from "pg";
import { lockKey, pool, tx, type Db } from "./db.js";
import { apiError, variantError, forbidden, notFound, refuseInvalid, route, type Ctx, type MultipartForm, type Reply } from "./http.js";
import { BODIES, bodyObject, keyErrors } from "./bodies.js";
import type { Session } from "./auth.js";
import { queueMail } from "./mail.js";
import { StorageDown, deleteObject, documentKey, getObject, putObject, storageUnavailable } from "./storage.js";
import { pdfDocument } from "./pdf.js";
import { DOCUMENT_TYPES, type DocumentType } from "../shared/format.js";
import { daysBetween, isLocalDate, isoWithOffset, localDateOf, type LocalDate } from "../shared/time.js";

type DocumentStatus = "submitted" | "approved" | "expiring" | "expired" | "superseded";
const EXPIRING_DAYS = 14;
const STATUS_WORDS: Record<DocumentStatus, string> = {
  submitted: "Submitted", approved: "Approved", expiring: "Expiring", expired: "Expired", superseded: "Superseded",
};

interface DocumentRow {
  id: string; kitchen_id: string; member_id: string; business_name: string; email: string; member_name: string; type: DocumentType;
  expiry_date: LocalDate; file_name: string; content_type: string; size_bytes: number;
  uploaded_at: Date; approved_at: Date | null; superseded: boolean; version: number; object_stored: boolean;
}

/** Superseded and submitted as stored; an approved document's status from its expiry date in kitchen time. */
export function documentStatus(doc: Pick<DocumentRow, "approved_at" | "expiry_date" | "superseded">, today: LocalDate): DocumentStatus {
  if (doc.superseded) return "superseded";
  if (!doc.approved_at) return "submitted";
  if (today > doc.expiry_date) return "expired";
  return daysBetween(today, doc.expiry_date) <= EXPIRING_DAYS ? "expiring" : "approved";
}

/** Per member and type, the approved document (approved, expiring or expired) with the latest expiry date. */
export function currentDocuments(docs: DocumentRow[]): Map<string, DocumentRow> {
  const current = new Map<string, DocumentRow>();
  for (const doc of docs) {
    if (!doc.approved_at) continue;
    const key = `${doc.member_id}:${doc.type}`;
    const held = current.get(key);
    if (!held || doc.expiry_date > held.expiry_date || (doc.expiry_date === held.expiry_date && doc.approved_at > held.approved_at!)) {
      current.set(key, doc);
    }
  }
  return current;
}

const DOC_SQL = `SELECT d.*, m.business_name, m.email, m.name AS member_name FROM documents d JOIN members m ON m.id = d.member_id`;
/** The published listing order: newest upload first; ties follow the seed order in Seed data. */
const NEWEST_FIRST = "d.uploaded_at DESC, d.seed_order NULLS LAST, d.id DESC";

export async function memberDocuments(db: Db, where: string, args: unknown[], order = "m.business_name, d.type, d.uploaded_at"): Promise<DocumentRow[]> {
  const { rows } = await db.query(`${DOC_SQL} WHERE ${where} ORDER BY ${order}`, args);
  return rows as DocumentRow[];
}

function documentJson(doc: DocumentRow, zone: string, current: Map<string, DocumentRow>): Record<string, unknown> {
  const today = localDateOf(Date.now(), zone);
  return {
    id: doc.id, memberId: doc.member_id, businessName: doc.business_name, type: doc.type, expiryDate: doc.expiry_date,
    status: documentStatus(doc, today), current: current.get(`${doc.member_id}:${doc.type}`)?.id === doc.id,
    fileName: doc.file_name, contentType: doc.content_type, sizeBytes: doc.size_bytes,
    uploadedAt: isoWithOffset(doc.uploaded_at.getTime(), zone),
    approvedAt: doc.approved_at ? isoWithOffset(doc.approved_at.getTime(), zone) : null,
    version: doc.version,
  };
}

/** The document rule for holds and confirms: an approved current document of each required type that outlasts the block. */
export async function documentProblem(db: Db, memberId: string, required: DocumentType[], lastBlockDate: LocalDate): Promise<string | null> {
  const current = currentDocuments(await memberDocuments(db, "d.member_id = $1", [memberId]));
  for (const type of required) {
    const doc = current.get(`${memberId}:${type}`);
    if (!doc) return `Upload an approved ${DOCUMENT_TYPES[type]} before booking.`;
    if (lastBlockDate > doc.expiry_date) return `Your ${DOCUMENT_TYPES[type]} expires on ${doc.expiry_date}, before this block.`;
  }
  return null;
}

/** The check-in document rule: a current document of every required type whose expiry has not ended today. */
export async function checkInDocumentProblem(db: Db, memberId: string, required: DocumentType[], today: LocalDate): Promise<string | null> {
  const current = currentDocuments(await memberDocuments(db, "d.member_id = $1", [memberId]));
  for (const type of required) {
    const doc = current.get(`${memberId}:${type}`);
    if (!doc) return `No approved ${DOCUMENT_TYPES[type]} on file; check-in is refused.`;
    if (today > doc.expiry_date) return `The ${DOCUMENT_TYPES[type]} expired on ${doc.expiry_date}; check-in is refused.`;
  }
  return null;
}

/** Uploads and approvals of one member's documents of one type are settled one at a time. */
const lockDocuments = (client: pg.PoolClient, memberId: string, type: string): Promise<void> =>
  lockKey(client, `documents:${memberId}:${type}`);

/** Queues each due 14-day and 3-day notice, once per current document. */
export async function queueExpiryNotices(client: pg.PoolClient, memberId: string | null): Promise<void> {
  const { rows: kitchens } = await client.query("SELECT id, time_zone FROM kitchens");
  for (const k of kitchens) {
    const today = localDateOf(Date.now(), k.time_zone);
    const docs = await memberDocuments(client, "d.kitchen_id = $1 AND ($2::text IS NULL OR d.member_id = $2)", [k.id, memberId]);
    for (const doc of currentDocuments(docs).values()) {
      const left = daysBetween(today, doc.expiry_date);
      const notice = left >= 4 && left <= EXPIRING_DAYS ? "14-day" : left >= 0 && left <= 3 ? "3-day" : null;
      if (!notice) continue;
      const { rowCount } = await client.query(
        "INSERT INTO document_notices (document_id, notice) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [doc.id, notice],
      );
      if (rowCount) {
        const kind = DOCUMENT_TYPES[doc.type];
        await queueMail(client, doc.email, `${notice} notice: your ${kind} expires on ${doc.expiry_date}`, [
          `Your ${kind} for ${doc.business_name} expires on ${doc.expiry_date}.`,
          `Upload a renewed ${kind} in Lineboard so the operator can approve it before then.`,
          "Bookings that end after the expiry date are refused until a renewal is approved.",
        ]);
      }
    }
  }
}

function sniff(data: Buffer): string | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

/** Letters, digits, spaces, dots, hyphens and underscores; no path; at most 100 characters. */
function sanitisedName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? "").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 100) || "document";
}

export function fileReply(data: Buffer, contentType: string, name: string): Reply {
  return {
    status: 200, bytes: data,
    headers: {
      "Content-Type": contentType, "Content-Disposition": `attachment; filename="${sanitisedName(name)}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "no-store",
    },
  };
}

export async function documentFile(doc: DocumentRow): Promise<Reply> {
  const unavailable = storageUnavailable("storage_unavailable_download");
  let data: Buffer | null;
  try {
    data = await getObject(documentKey(doc.kitchen_id, doc.member_id, doc.id));
  } catch (error) {
    if (error instanceof StorageDown) throw unavailable;
    throw error;
  }
  if (!data) throw unavailable;
  return fileReply(data, doc.content_type, doc.file_name);
}

/** A seed document's one-page PDF; it reads only fixed facts (the holder's own name, never the renamable business). */
export function seedDocumentPdf(holderName: string, type: DocumentType, expiry: LocalDate): Buffer {
  const title = type === "insurance_certificate" ? "Certificate of insurance" : "Food-handler card";
  return pdfDocument([title, "", `Holder: ${holderName}`, `Valid until: ${expiry}`, "", "Issued for use at a shared commercial kitchen."]);
}

/** Seed document objects that could not be written at first start (outside the queued counts). */
export async function storePendingSeedObjects(): Promise<void> {
  const docs = await memberDocuments(pool, "NOT d.object_stored", []);
  for (const doc of docs) {
    try {
      await putObject(documentKey(doc.kitchen_id, doc.member_id, doc.id), seedDocumentPdf(doc.member_name, doc.type, doc.expiry_date), doc.content_type);
    } catch (error) {
      if (error instanceof StorageDown) return;
      throw error;
    }
    await pool.query("UPDATE documents SET object_stored = true WHERE id = $1", [doc.id]);
  }
}

async function findDocument(s: Session, id: string, db: Db = pool): Promise<DocumentRow> {
  const [doc] = await memberDocuments(db, "d.id = $1 AND d.kitchen_id = $2", [id, s.kitchen.id]);
  if (!doc || (s.person.role === "member" && doc.member_id !== s.person.memberId)) throw notFound();
  return doc;
}

async function kitchenCurrent(s: Session, db: Db = pool): Promise<Map<string, DocumentRow>> {
  return currentDocuments(await memberDocuments(db, "d.kitchen_id = $1", [s.kitchen.id]));
}

route("GET", "/api/documents", async (ctx) => {
  const s = ctx.session!;
  const memberFilter = s.person.role === "member" ? s.person.memberId : ctx.query.get("memberId");
  const docs = await memberDocuments(pool, "d.kitchen_id = $1 AND ($2::text IS NULL OR d.member_id = $2)", [s.kitchen.id, memberFilter], NEWEST_FIRST);
  const current = await kitchenCurrent(s);
  return { status: 200, body: { documents: docs.map((d) => documentJson(d, s.kitchen.timeZone, current)) } };
});

route("GET", "/api/documents/:id", async (ctx) => {
  const s = ctx.session!;
  const doc = await findDocument(s, ctx.params.id!);
  return { status: 200, body: { document: documentJson(doc, s.kitchen.timeZone, await kitchenCurrent(s)) } };
});

route("GET", "/api/documents/:id/file", async (ctx) => documentFile(await findDocument(ctx.session!, ctx.params.id!)));

route("POST", "/api/documents", async (ctx: Ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "member") throw forbidden();
  const form = ctx.body as MultipartForm;
  const file = form.files.get("file");
  const detected = file && file.data.length > 0 ? sniff(file.data) : null;
  if (file && file.data.length > 0 && !detected) throw apiError(415, "unsupported_file_type");
  const type = form.fields.get("type") ?? "";
  const expiry = form.fields.get("expiryDate") ?? "";
  const errors = keyErrors([...form.fields.keys(), ...form.files.keys()], BODIES.document);
  if (!errors.type && !(type in DOCUMENT_TYPES)) errors.type = "Choose insurance certificate or food-handler card.";
  // A missing expiry date or file has its own published message.
  if (!isLocalDate(expiry) || expiry < localDateOf(Date.now(), s.kitchen.timeZone)) errors.expiryDate = "Enter an expiry date of today or later.";
  if (!file || !detected) errors.file = "Choose a file to upload.";
  refuseInvalid(errors);
  const id = `doc_${randomBytes(8).toString("hex")}`;
  const key = documentKey(s.kitchen.id, s.person.memberId!, id);
  try {
    await putObject(key, file!.data, detected!);
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable("storage_unavailable_upload");
    throw error;
  }
  let written: Record<string, unknown>;
  try {
    written = await tx(async (client) => {
      await lockDocuments(client, s.person.memberId!, type);
      // The new upload supersedes every older submitted document of its type; approved ones never.
      await client.query(
        `UPDATE documents SET superseded = true, version = version + 1
         WHERE member_id = $1 AND type = $2 AND approved_at IS NULL AND NOT superseded`,
        [s.person.memberId, type]);
      await client.query(
        `INSERT INTO documents (id, kitchen_id, member_id, type, expiry_date, file_name, content_type, size_bytes, uploaded_at, object_stored)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp(), true)`,
        [id, s.kitchen.id, s.person.memberId, type, expiry, file!.name, detected, file!.data.length],
      );
      // The 201 shows the document as it stood when it was written, even if a second upload of
      // the same type supersedes it a moment later.
      return documentJson(await findDocument(s, id, client), s.kitchen.timeZone, await kitchenCurrent(s, client));
    });
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
  return { status: 201, body: { document: written } };
}, { body: "multipart" });

route("POST", "/api/documents/:id/approve", async (ctx) => {
  const s = ctx.session!;
  const doc = await findDocument(s, ctx.params.id!);
  if (s.person.role !== "operator") throw forbidden();
  const zone = s.kitchen.timeZone;
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.approveDocument);
  if (!errors.version && !Number.isInteger(body.version)) errors.version = "Reload and try again.";
  refuseInvalid(errors);
  await tx(async (client) => {
    await lockDocuments(client, doc.member_id, doc.type);
    const now = await findDocument(s, doc.id, client);
    const current = documentJson(now, zone, await kitchenCurrent(s, client));
    if (now.superseded) {
      const { rows } = await client.query(
        "SELECT id FROM documents WHERE member_id = $1 AND type = $2 ORDER BY uploaded_at DESC, id DESC LIMIT 1", [now.member_id, now.type]);
      throw variantError(409, "document_superseded", [DOCUMENT_TYPES[now.type], now.business_name], { current, supersededBy: rows[0].id });
    }
    if (body.version !== now.version) {
      throw variantError(412, "stale_version_document", [], { current });
    }
    if (now.approved_at) {
      const from = documentStatus(now, localDateOf(Date.now(), zone));
      throw variantError(409, "invalid_transition_document", [STATUS_WORDS[from]], { from, action: "approve", current });
    }
    await client.query("UPDATE documents SET approved_at = clock_timestamp(), version = version + 1 WHERE id = $1", [doc.id]);
    await queueExpiryNotices(client, doc.member_id);
  });
  const approved = await findDocument(s, doc.id);
  return { status: 200, body: { document: documentJson(approved, s.kitchen.timeZone, await kitchenCurrent(s)) } };
});
