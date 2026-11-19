// Compliance documents: upload (object and row together), listing, file download and review.
import { createHash, randomUUID } from "node:crypto";
import { pool, rows, theRow, tx } from "./db.ts";
import { ApiError } from "./http.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields } from "./validate.ts";
import { documentFor, ownMemberId } from "./scope.ts";
import { projectDocument, type DocumentRow } from "./projections.ts";
import { deleteObject, documentKey, getObject, putDocumentConfirmed } from "./storage.ts";
import { homeDate } from "./ledger.ts";
import { validThrough } from "./coverage.ts";
import type { DocumentContentType, DocumentType } from "../shared/api.ts";

const TYPES: DocumentType[] = ["certificate_of_insurance", "food_handler_certificate", "business_licence"];
const MIN_COVER = 1_000_000;

const LEADING_BYTES: Record<DocumentContentType, Buffer> = {
  "application/pdf": Buffer.from("%PDF-", "latin1"),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
};

/** The detected type: the file part's declared type, when its leading bytes agree with it. */
function detectedType(declared: string, data: Buffer): DocumentContentType | null {
  const type = (Object.keys(LEADING_BYTES) as DocumentContentType[]).find((t) => t === declared);
  return type && data.subarray(0, LEADING_BYTES[type].length).equals(LEADING_BYTES[type]) ? type : null;
}

/** Display text only: last path segment, unsafe characters replaced, at most 120 characters, never empty. */
function displayName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  return last.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

export function fileHeaders(contentType: string, fileName: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
  };
}

const DOCUMENT_SELECT = `SELECT d.id, d.member_id, d.type, d.expiry_date, d.status, d.file_name, d.content_type, d.size_bytes, d.sha256,
  d.rejection_reason, d.created_at, m.business_name FROM documents d JOIN members m ON m.id = d.member_id`;

// POST /api/documents (multipart)
export async function uploadDocument(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const memberId = ownMemberId(user);
  const form = ctx.multipart ?? { fields: new Map<string, string>(), files: [], repeated: [] };
  const file = form.files.find((f) => f.field === "file");
  const contentType = file && file.data.length > 0 ? detectedType(file.declaredType, file.data) : null;
  if (file && file.data.length > 0 && !contentType) throw new ApiError("unsupported_type");
  const type = form.fields.get("type");
  const isInsurance = type === "certificate_of_insurance";
  const allowed = ["type", "expiry_date", "file", ...(isInsurance ? ["per_occurrence_limit", "names_additional_insured"] : [])];
  const fields = new Fields(Object.fromEntries([...form.fields, ...form.files.map((f) => [f.field, f.fileName] as const)]), allowed);
  const docType = TYPES.find((t) => t === type) ?? fields.fail("type", "Choose a document type.");
  const expiry = fields.date("expiry_date", "Enter the expiry date shown on the document.");
  if (!file || !contentType) fields.fail("file", "Choose a file to upload.");
  for (const repeated of form.repeated) fields.fail(repeated, "Send this field once.");
  if (isInsurance) {
    const limit = form.fields.get("per_occurrence_limit");
    if (limit === undefined || !/^\d{1,12}$/.test(limit) || Number(limit) < MIN_COVER) {
      fields.fail("per_occurrence_limit", "Coverage must be at least $1,000,000 per occurrence.");
    }
    if (form.fields.get("names_additional_insured") !== "true") {
      fields.fail("names_additional_insured", "The certificate must name the incubator as additional insured.");
    }
  }
  if (docType === undefined || expiry === undefined || !file || !contentType) return fields.reject();
  fields.raise();
  const id = randomUUID();
  const key = documentKey(user.tenantId, memberId, id);
  const sha256 = createHash("sha256").update(file.data).digest("hex");
  await putDocumentConfirmed(key, file.data, contentType, sha256, id);
  try {
    return await tx(async (db) => {
      await db.query(
        `INSERT INTO documents (id, member_id, type, expiry_date, status, file_name, content_type, size_bytes, sha256, created_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)`,
        [id, memberId, docType, expiry, displayName(file.fileName), contentType, file.data.length, sha256, new Date(now())],
      );
      const row = await theRow<DocumentRow>(db, `${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
      return json(201, { document: projectDocument(row) });
    });
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
}

// GET /api/documents
export async function listDocuments(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const status = ctx.query.get("status");
  const fields = new Fields({ status }, ["status"]);
  if (status !== null && status !== "pending") fields.fail("status", "Only status=pending is supported.");
  fields.raise();
  const scope = user.role === "member" ? "d.member_id = $1" : "m.home_site_id = $1";
  const list = await rows<DocumentRow & { business_name: string }>(
    pool,
    `${DOCUMENT_SELECT} WHERE ${scope} AND m.tenant_id = $2 ${status ? "AND d.status = 'pending'" : ""} ORDER BY d.created_at DESC, d.seq DESC`,
    [user.role === "member" ? ownMemberId(user) : user.siteId, user.tenantId],
  );
  return json(200, { documents: list.map((d) => ({ ...projectDocument(d), business_name: d.business_name })) });
}

async function documentRow(id: string): Promise<DocumentRow> {
  const [row] = await rows<DocumentRow>(pool, `${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  if (!row) throw new ApiError("not_found");
  return row;
}

// GET /api/documents/{id}
export async function getDocument(ctx: AuthedCtx): Promise<Reply> {
  const found = await documentFor(pool, ctx.user, ctx.params.id);
  return json(200, { document: projectDocument(await documentRow(found.id)) });
}

// GET /api/documents/{id}/file
export async function documentFile(ctx: AuthedCtx): Promise<Reply> {
  const found = await documentFor(pool, ctx.user, ctx.params.id);
  const doc = await documentRow(found.id);
  const data = await getObject(documentKey(ctx.user.tenantId, doc.member_id, doc.id));
  return {
    kind: "bytes",
    status: 200,
    data,
    headers: { ...fileHeaders(doc.content_type, doc.file_name), "Content-Length": String(doc.size_bytes), ETag: `"${doc.sha256}"` },
  };
}

// POST /api/documents/{id}/verify and /reject
export async function reviewDocument(ctx: AuthedCtx, decision: "verified" | "rejected"): Promise<Reply> {
  const found = await documentFor(pool, ctx.user, ctx.params.id);
  const fields = new Fields(ctx.body, decision === "rejected" ? ["reason"] : []);
  return tx(async (db) => {
    const [doc] = await rows<DocumentRow>(db, `${DOCUMENT_SELECT} WHERE d.id = $1 FOR UPDATE OF d`, [found.id]);
    if (!doc) throw new ApiError("not_found");
    if (doc.status !== "pending") throw new ApiError("invalid_transition");
    const reason = decision === "rejected" ? fields.string("reason", "Give a reason the member can act on.", 3, 300) : null;
    fields.raise();
    if (decision === "verified" && doc.expiry_date < (await homeDate(db, doc.member_id, now()))) throw new ApiError("document_expired");
    await db.query("UPDATE documents SET status = $2, rejection_reason = $3 WHERE id = $1", [doc.id, decision, reason ?? null]);
    const after = await theRow<DocumentRow>(db, `${DOCUMENT_SELECT} WHERE d.id = $1`, [doc.id]);
    if (decision === "rejected") return json(200, { document: projectDocument(after) });
    const coverage = await validThrough(db, doc.member_id);
    return json(200, { document: projectDocument(after), valid_through: coverage[doc.type] });
  });
}
