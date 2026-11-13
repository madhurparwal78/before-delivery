// Documents: upload checks (judged by leading bytes), private objects, and serving files back.

import { createHash, randomUUID } from "node:crypto";
import type { DocumentKind, DocumentNotice, DocumentRecord, NoticePoint } from "../shared/api.js";
import { db } from "./db.js";
import { ApiError, type FieldErrors } from "./errors.js";
import { date as dateField, FILL_IN } from "./fields.js";
import { iso, kitchenTime } from "./kitchen.js";
import type { Part } from "./multipart.js";
import { afterUpload, coverState } from "./onboarding.js";
import { col, type Json, type Row } from "./postgres.js";
import { getObject, putObject, StorageUnavailable } from "./storage.js";
import { findTenant } from "./tenants.js";

const MAX_FILE_BYTES = 5_000_000;
const MINIMUM_LIMIT_DOLLARS = 1_000_000;
const INSURANCE = "insurance_certificate";

const SIGNATURES = [
  { ext: "pdf", contentType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { ext: "png", contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: "jpg", contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
] as const;

type Signature = (typeof SIGNATURES)[number];

interface Upload {
  kind: DocumentKind;
  expiresOn: string;
  perOccurrenceLimit: number | null;
  additionalInsured: boolean | null;
  file: Buffer;
  type: Signature;
}

/** The parts the upload accepts: the insurance fields only with kind insurance_certificate. */
export function uploadFields(parts: ReadonlyMap<string, Part>): readonly string[] {
  const base = ["kind", "expiresOn", "file"];
  return parts.get("kind")?.data.toString("utf8") === INSURANCE ? [...base, "perOccurrenceLimit", "additionalInsured"] : base;
}

function sniff(file: Buffer): Signature | null {
  return SIGNATURES.find((s) => file.length >= s.bytes.length && s.bytes.every((byte, i) => file[i] === byte)) ?? null;
}

export async function validateUpload(parts: ReadonlyMap<string, Part>, errors: FieldErrors): Promise<Upload> {
  const value = (name: string): string | null => parts.get(name)?.data.toString("utf8") ?? null;
  const kindText = value("kind");
  const kind: DocumentKind = kindText === "food_handler_card" ? "food_handler_card" : INSURANCE;
  if (kindText !== INSURANCE && kindText !== "food_handler_card") errors.kind = "Choose a certificate of insurance or a food-handler card.";
  const expiresOn = dateField(value("expiresOn"), "expiresOn", errors);
  if (expiresOn && expiresOn < (await kitchenTime(db)).today) errors.expiresOn = "That date has already passed.";
  const filePart = parts.get("file");
  const file = filePart?.data ?? Buffer.alloc(0);
  const type = sniff(file);
  if (!filePart || filePart.filename === null) errors.file = FILL_IN;
  else if (file.length > MAX_FILE_BYTES) errors.file = "That file is too large.";
  else if (!type) errors.file = "Upload a PDF, PNG or JPEG file.";
  let perOccurrenceLimit: number | null = null;
  let additionalInsured: boolean | null = null;
  if (kindText === INSURANCE) {
    const limit = value("perOccurrenceLimit")?.trim() ?? "";
    perOccurrenceLimit = /^\d{1,13}$/.test(limit) ? Number(limit) : null;
    if (perOccurrenceLimit === null) errors.perOccurrenceLimit = "Give the limit in whole dollars.";
    else if (perOccurrenceLimit < MINIMUM_LIMIT_DOLLARS) errors.perOccurrenceLimit = "Coverage is below the kitchen's minimum per occurrence.";
    const insured = value("additionalInsured");
    additionalInsured = insured === "true";
    if (insured !== "true" && insured !== "false") errors.additionalInsured = "Answer true or false.";
    else if (!additionalInsured) errors.additionalInsured = "The certificate must name Halfsheet Commissary as additional insured.";
  }
  return { kind, expiresOn, perOccurrenceLimit, additionalInsured, file, type: type ?? SIGNATURES[0] };
}

/** A notice reads sent only once its queued email is marked delivered. */
const DOCUMENT_SELECT = `
  SELECT d.*, d.expires_on::text AS expires_text,
         EXISTS (SELECT 1 FROM current_documents c WHERE c.id = d.id) AS is_current,
         (SELECT COALESCE(json_agg(json_build_object('point', n.point, 'sentAt', (extract(epoch FROM m.delivered_at) * 1000)::float8) ORDER BY n.claimed_at), '[]'::json)
            FROM notice_claims n JOIN mail_queue m ON m.id = n.mail_id WHERE n.document_id = d.id) AS notices
    FROM documents d`;

function noticesOf(value: Json | Date | undefined): DocumentNotice[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: Json): DocumentNotice => {
    const fields = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
    const point: NoticePoint = fields.point === "today" ? "today" : "seven_days";
    const sentAt = fields.sentAt;
    return typeof sentAt === "number" ? { point, status: "sent", sentAt: iso(sentAt) } : { point, status: "queued", sentAt: null };
  });
}

function documentView(row: Row, today: string): DocumentRecord {
  const current = col.bool(row, "is_current");
  const expiresOn = col.text(row, "expires_text");
  return {
    id: col.text(row, "id"),
    tenantId: col.text(row, "tenant_id"),
    kind: col.text(row, "kind") === INSURANCE ? INSURANCE : "food_handler_card",
    expiresOn,
    perOccurrenceLimit: col.intOrNull(row, "per_occurrence_limit"),
    additionalInsured: col.boolOrNull(row, "additional_insured"),
    contentType: col.textOrNull(row, "content_type"),
    sizeBytes: col.intOrNull(row, "size_bytes"),
    sha256: col.textOrNull(row, "sha256"),
    hasFile: col.textOrNull(row, "object_key") !== null,
    current,
    ...coverState(expiresOn, current, today),
    uploadedAt: iso(col.time(row, "uploaded_at")),
    notices: noticesOf(row.notices),
  };
}

export async function documentOwner(id: string): Promise<string | null> {
  const [row] = await db.query("SELECT tenant_id FROM documents WHERE id = $1", [id]);
  return row ? col.text(row, "tenant_id") : null;
}

export async function listDocuments(tenantId: string): Promise<DocumentRecord[]> {
  return db.transaction(async (tx) => {
    const { today } = await kitchenTime(tx);
    return (await tx.query(`${DOCUMENT_SELECT} WHERE d.tenant_id = $1 ORDER BY d.seq DESC`, [tenantId])).map((row) => documentView(row, today));
  });
}

export async function getDocument(id: string): Promise<DocumentRecord> {
  return db.transaction(async (tx) => {
    const { today } = await kitchenTime(tx);
    const [row] = await tx.query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
    if (!row) throw new Error(`document ${id} vanished`);
    return documentView(row, today);
  });
}

const storageDown = (): ApiError =>
  new ApiError(503, "storage_unavailable", "Document storage is unreachable. Nothing was saved; try again shortly.");

/** Stores the object first, then writes the row (and the applied → documents_pending edge). */
export async function upload(tenantId: string, input: Upload): Promise<DocumentRecord> {
  const id = randomUUID();
  const key = `tenants/${tenantId}/documents/${id}.${input.type.ext}`;
  try {
    await putObject(key, input.file, input.type.contentType);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    console.error(`document upload for tenant ${tenantId}:`, error.message);
    throw storageDown();
  }
  return db.transaction(async (tx) => {
    const tenant = await findTenant(tx, tenantId, true);
    if (!tenant) throw new Error(`tenant ${tenantId} vanished`);
    await tx.query(
      `INSERT INTO documents (id, tenant_id, kind, expires_on, per_occurrence_limit, additional_insured, content_type, size_bytes, sha256, object_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, tenantId, input.kind, input.expiresOn, input.perOccurrenceLimit, input.additionalInsured, input.type.contentType, input.file.length,
        createHash("sha256").update(input.file).digest("hex"), key],
    );
    const cover = input.kind === INSURANCE
      ? { ...tenant.cover, insuranceExpiresOn: input.expiresOn }
      : { ...tenant.cover, foodHandlerExpiresOn: input.expiresOn };
    const next = afterUpload(tenant.onboarding, cover);
    if (next !== tenant.onboarding) await tx.query("UPDATE tenants SET onboarding = $2 WHERE id = $1", [tenantId, next]);
    const [row] = await tx.query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
    if (!row) throw new Error(`document ${id} vanished`);
    return documentView(row, (await kitchenTime(tx)).today);
  });
}

/** Reads the object on each authorised request, with headers that stop the browser running it. */
export async function documentFile(id: string): Promise<{ bytes: Buffer; headers: Record<string, string> }> {
  const [row] = await db.query("SELECT kind, content_type, object_key FROM documents WHERE id = $1", [id]);
  const key = row ? col.textOrNull(row, "object_key") : null;
  if (!row || key === null) throw new ApiError(404, "file_not_found", "This document is on paper; there is no file.");
  let bytes: Buffer;
  try {
    bytes = await getObject(key);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      console.error(`document file ${id}:`, error.message);
      throw new ApiError(503, "storage_unavailable", "Previews are unavailable while document storage is unreachable.");
    }
    throw error;
  }
  const ext = key.slice(key.lastIndexOf(".") + 1);
  return {
    bytes,
    headers: {
      "Content-Type": col.text(row, "content_type"),
      "Content-Disposition": `inline; filename="${col.text(row, "kind")}-${id}.${ext}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, no-store",
    },
  };
}
