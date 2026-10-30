// Compliance documents (brief: Documents, Compliance documents).
import { randomUUID } from "node:crypto";
import { DOCUMENT_KINDS, FILE_CAP_BYTES, HOLDER_MAX, REASON_MAX, type DocumentKind } from "../../shared/kitchen";
import { isKitchenDate } from "../../shared/time";
import { audit, one, pool, rows, transaction } from "../db";
import { documentApproved, documentRejected } from "../emails";
import { ApiError, FieldErrors, invalidTransition, notFound, validation } from "../errors";
import { disposition, route, type Ctx } from "../http";
import { queueEmail } from "../mail";
import { documentView, kitchenToday, loadDocument, tenantRows, type DocumentRow } from "../records";
import { documentFile } from "../documentFiles";
import { getObject } from "../storage";
import { unitOfWork } from "../unitOfWork";
import { kickSweep } from "../sweep";

const SIGNATURES: { type: string; extension: string; bytes: number[] }[] = [
  { type: "application/pdf", extension: "pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: "image/jpeg", extension: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

const detectType = (data: Buffer) => SIGNATURES.find((s) => s.bytes.every((byte, i) => data[i] === byte));

interface Part {
  name: string;
  fileName: string | null;
  data: Buffer;
}

function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) throw validation({ file: "Send the upload as multipart form data." });
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const chunk = body.subarray(start + delimiter.length + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = chunk.subarray(0, split).toString("utf8");
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const fileName = /filename="((?:[^"\\]|\\.)*)"/i.exec(head)?.[1] ?? null;
      if (name) parts.push({ name, fileName, data: chunk.subarray(split + 4) });
    }
    start = next;
  }
  return parts;
}

/** The display name: last path segment, no control characters, at most 120 characters. */
function displayName(raw: string): string {
  const cleaned = (raw.split(/[/\\]/).pop() ?? "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);
  return cleaned || "document";
}

const loadOwnDocument = (ctx: Ctx<undefined>): Promise<DocumentRow> => loadDocument(pool, ctx.user, ctx.params.id);

const isDocumentKind = (value: unknown): value is DocumentKind => DOCUMENT_KINDS.includes(value as DocumentKind);

export const documentRoutes = [
  route({
    method: "POST",
    path: "/api/documents",
    roles: ["operator", "owner"],
    body: "multipart",
    async handle(ctx) {
      const parts = parseMultipart(ctx.body, ctx.contentType);
      const field = (name: string): string | undefined => parts.find((p) => p.name === name && p.fileName === null)?.data.toString("utf8");
      const file = parts.find((p) => p.name === "file" && p.fileName !== null);
      const tenantId = ctx.user.role === "operator" ? field("tenant_id") : (ctx.user.tenant_id as string);
      const [tenant] = tenantId ? await tenantRows(pool, tenantId) : [];
      if (tenantId && !tenant) throw notFound();
      if (file && file.data.length > FILE_CAP_BYTES) throw new ApiError(413, "file_too_large", "That file is larger than the upload limit.");
      const detected = file && file.data.length > 0 ? detectType(file.data) : undefined;
      if (file && file.data.length > 0 && !detected) {
        throw new ApiError(415, "unsupported_file_type", "Only PDF, JPEG or PNG files are accepted. This file is not one of them.");
      }
      const errors = new FieldErrors();
      const kind = field("kind");
      const expiresOn = field("expires_on");
      const holder = (field("holder_name") ?? "").trim();
      if (!tenant) errors.add("tenant_id", "Choose the tenant this document belongs to.");
      if (!isDocumentKind(kind)) errors.add("kind", "Choose a document type.");
      if (!isKitchenDate(expiresOn)) errors.add("expires_on", "Give the expiry date as YYYY-MM-DD.");
      else if (expiresOn < kitchenToday(ctx.nowMs)) errors.add("expires_on", "The expiry date can't be in the past.");
      if (kind === "food_handler_card" && (holder.length === 0 || holder.length > HOLDER_MAX)) {
        errors.add("holder_name", `Give the name on the card, up to ${HOLDER_MAX} characters.`);
      }
      if (!file || file.data.length === 0) errors.add("file", "Choose a PDF, JPEG or PNG file.");
      errors.throwIfAny();
      const type = detected as (typeof SIGNATURES)[number];
      const id = randomUUID();
      const key = `tenants/${tenant.id}/documents/${id}.${type.extension}`;
      // The record is written in an uncommitted transaction, the file is stored, then the record commits.
      const doc = await unitOfWork(async (db, effects) => {
        const inserted = (await one<DocumentRow>(
          db,
          `INSERT INTO documents (id, tenant_id, kind, holder_name, expires_on, status, file_name, content_type, size_bytes, storage_key, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, 'pending_review', $6, $7, $8, $9, $10) RETURNING *`,
          [id, tenant.id, kind, kind === "food_handler_card" ? holder : null, expiresOn, displayName((file as Part).fileName as string), type.type, (file as Part).data.length, key, new Date(ctx.nowMs)],
        )) as DocumentRow;
        const moved = await db.query("UPDATE tenants SET lifecycle = 'documents_review' WHERE id = $1 AND lifecycle = 'applied'", [tenant.id]);
        if (moved.rowCount) await audit(db, ctx.user.id, "tenant", tenant.id, "documents_review");
        await audit(db, ctx.user.id, "document", id, "uploaded", { kind });
        await effects.store(key, (file as Part).data, type.type);
        return inserted;
      });
      return { status: 201, json: documentView(doc, ctx.nowMs) };
    },
  }),
  route({
    method: "GET",
    path: "/api/documents",
    roles: ["operator", "owner"],
    async handle(ctx) {
      const tenantId = ctx.user.role === "operator" ? ctx.query.get("tenant_id") || null : ctx.user.tenant_id;
      const docs = await rows<DocumentRow>(pool, "SELECT * FROM documents WHERE ($1::text IS NULL OR tenant_id = $1) ORDER BY uploaded_at DESC, id", [tenantId]);
      return { status: 200, json: { documents: docs.map((d) => documentView(d, ctx.nowMs)) } };
    },
  }),
  route<DocumentRow>({
    method: "GET",
    path: "/api/documents/:id",
    roles: ["operator", "owner"],
    load: loadOwnDocument,
    async handle(ctx) {
      return { status: 200, json: documentView(ctx.loaded, ctx.nowMs) };
    },
  }),
  route<DocumentRow>({
    method: "GET",
    path: "/api/documents/:id/file",
    roles: ["operator", "owner"],
    load: loadOwnDocument,
    async handle(ctx) {
      const data = await documentFile(pool, ctx.loaded);
      if (!data) throw notFound();
      return { status: 200, file: { body: data, contentType: ctx.loaded.content_type, disposition: disposition("attachment", ctx.loaded.file_name) } };
    },
  }),
  route<DocumentRow>({
    method: "POST",
    path: "/api/documents/:id/approve",
    roles: ["operator"],
    body: "json",
    load: loadOwnDocument,
    async handle(ctx) {
      if (ctx.loaded.status !== "pending_review") throw invalidTransition();
      // Approval reads the stored file back in full first.
      const stored = await getObject(ctx.loaded.storage_key);
      if (!stored || stored.length !== ctx.loaded.size_bytes) {
        throw new ApiError(409, "file_missing", "The stored file can't be read. Ask the tenant to upload it again.");
      }
      const doc = await transaction(async (db) => {
        const approved = await one<DocumentRow>(
          db,
          "UPDATE documents SET status = 'approved', reviewed_at = $2 WHERE id = $1 AND status = 'pending_review' RETURNING *",
          [ctx.loaded.id, new Date(ctx.nowMs)],
        );
        if (!approved) throw invalidTransition();
        const [tenant] = await tenantRows(db, approved.tenant_id);
        await queueEmail(db, documentApproved(tenant, approved.kind, approved.expires_on));
        await audit(db, ctx.user.id, "document", approved.id, "approved");
        return approved;
      });
      kickSweep();
      return { status: 200, json: documentView(doc, ctx.nowMs) };
    },
  }),
  route<DocumentRow>({
    method: "POST",
    path: "/api/documents/:id/reject",
    roles: ["operator"],
    body: "json",
    load: loadOwnDocument,
    async handle(ctx) {
      const reason = ctx.json.reason;
      if (typeof reason !== "string" || reason.trim().length === 0 || reason.length > REASON_MAX) {
        throw validation({ reason: "Give a reason for the tenant." });
      }
      const doc = await transaction(async (db) => {
        const rejected = await one<DocumentRow>(
          db,
          "UPDATE documents SET status = 'rejected', reviewed_at = $2, rejection_reason = $3 WHERE id = $1 AND status = 'pending_review' RETURNING *",
          [ctx.loaded.id, new Date(ctx.nowMs), reason],
        );
        if (!rejected) throw invalidTransition();
        const [tenant] = await tenantRows(db, rejected.tenant_id);
        await queueEmail(db, documentRejected(tenant, rejected.kind, reason));
        await audit(db, ctx.user.id, "document", rejected.id, "rejected", { reason });
        return rejected;
      });
      kickSweep();
      return { status: 200, json: documentView(doc, ctx.nowMs) };
    },
  }),
];
