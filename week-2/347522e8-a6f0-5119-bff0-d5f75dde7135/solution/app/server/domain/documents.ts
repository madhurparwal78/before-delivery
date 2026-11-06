// Compliance documents: upload (size cap, content sniffing, generated keys), review, listing.

import { randomUUID } from "node:crypto";
import type { DocumentView, RenterStatus } from "../../shared/api.js";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, type DocumentKind, type DocumentStatus, isDocumentCurrent } from "../../shared/documents.js";
import { isIsoDate } from "../../shared/kitchenTime.js";
import { iso, kitchenToday, now } from "../clock.js";
import { type Db, type Tx, only, pool, rows, transaction } from "../db.js";
import { FieldErrors, fail } from "../http/errors.js";
import type { FilePart } from "../http/multipart.js";
import { StorageUnavailable, putObject } from "../services/storage.js";
import { changeRenterStatus } from "./renterStatus.js";

const FILE_LIMIT = 5_000_000;
const NAME_LIMIT = 120;

export interface DocumentRow {
  id: string;
  renter_id: string;
  kind: DocumentKind;
  expires_on: string | null;
  status: DocumentStatus;
  original_name: string;
  size_bytes: number;
  content_type: string;
  object_key: string;
  created_at: Date;
  seq: number;
}

export function documentView(row: DocumentRow): DocumentView {
  return {
    id: row.id,
    renter_id: row.renter_id,
    kind: row.kind,
    expires_on: row.expires_on,
    status: row.status,
    original_name: row.original_name,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    created_at: iso(row.created_at),
  };
}

/** Every document the renter uploaded, newest first. */
export function documentsOf(db: Db, renterId: string): Promise<DocumentRow[]> {
  return rows<DocumentRow>(db, "SELECT * FROM documents WHERE renter_id = $1 ORDER BY seq DESC", [renterId]);
}

export function documentById(db: Db, documentId: string): Promise<DocumentRow> {
  return only<DocumentRow>(db, "SELECT * FROM documents WHERE id = $1", [documentId]);
}

interface ScanType {
  extension: "pdf" | "png" | "jpg";
  contentType: string;
}

/** The scan's type from its first bytes only. */
function sniffScan(content: Buffer): ScanType | null {
  if (content.subarray(0, 5).toString("latin1") === "%PDF-") return { extension: "pdf", contentType: "application/pdf" };
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", contentType: "image/png" };
  }
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { extension: "jpg", contentType: "image/jpeg" };
  return null;
}

/** Display text only: directory parts, `..` and control characters removed, cut to 120 characters. */
function displayName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  return base.split("..").join("").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, NAME_LIMIT);
}

export function documentKey(renterId: string, documentId: string, extension: string): string {
  return `renters/${renterId}/documents/${documentId}.${extension}`;
}

/** Moves an applied renter to review once one document of each kind is on file. */
async function reviewWhenComplete(tx: Tx, renterId: string): Promise<void> {
  const kinds = await rows<{ kind: DocumentKind }>(tx, "SELECT DISTINCT kind FROM documents WHERE renter_id = $1", [renterId]);
  if (DOCUMENT_KINDS.every((kind) => kinds.some((row) => row.kind === kind))) {
    await changeRenterStatus(tx, renterId, "applied", "documents_review");
  }
}

export async function uploadDocument(renterId: string, fields: Record<string, string>, file: FilePart | undefined): Promise<DocumentView> {
  const { status } = await only<{ status: RenterStatus }>(pool, "SELECT status FROM renters WHERE id = $1", [renterId]);
  if (status === "offboarded") throw fail(409, "renter_offboarded");
  const errors = new FieldErrors();
  const kind = DOCUMENT_KINDS.find((k) => k === fields.kind);
  if (!kind) errors.add("kind", "Choose a certificate of insurance, food-handler card or business licence.");
  const expiresOn = (fields.expires_on ?? "").trim() || null;
  const today = kitchenToday();
  if (expiresOn === null) {
    if (kind && kind !== "business_licence") errors.add("expires_on", `Enter the ${DOCUMENT_LABEL[kind]}'s expiry date.`);
  } else if (!isIsoDate(expiresOn)) errors.add("expires_on", "Enter the expiry date as YYYY-MM-DD.");
  else if (!isDocumentCurrent({ status: "approved", expires_on: expiresOn }, today)) errors.add("expires_on", "That expiry date has already passed.");
  if (!file?.content.length) errors.add("file", "Choose a scan file to upload.");
  if (!kind || !file?.content.length || !errors.empty) throw errors.error();
  if (file.content.length > FILE_LIMIT) throw fail(413, "file_too_large");
  const type = sniffScan(file.content);
  if (!type) throw fail(415, "unsupported_type");

  const id = randomUUID();
  const key = documentKey(renterId, id, type.extension);
  try {
    await putObject(key, file.content, type.contentType);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw fail(503, "storage_unavailable");
    throw error;
  }
  return transaction(async (tx) => {
    const row = await only<DocumentRow>(
      tx,
      `INSERT INTO documents (id, renter_id, kind, expires_on, status, original_name, size_bytes, content_type, object_key, created_at)
       VALUES ($1, $2, $3, $4, 'pending_review', $5, $6, $7, $8, $9) RETURNING *`,
      [id, renterId, kind, expiresOn, displayName(file.filename), file.content.length, type.contentType, key, iso(now())],
    );
    await reviewWhenComplete(tx, renterId);
    return documentView(row);
  });
}

export type ReviewDecision = "approve" | "reject";

/** Moves a pending document to approved or rejected. */
export async function decideDocument(tx: Tx, documentId: string, decision: ReviewDecision, note: string | null): Promise<DocumentRow> {
  const document = await only<DocumentRow>(tx, "SELECT * FROM documents WHERE id = $1 FOR UPDATE", [documentId]);
  const to: DocumentStatus = decision === "approve" ? "approved" : "rejected";
  if (document.status !== "pending_review") throw fail(409, "invalid_transition", { from: document.status, to });
  if (decision === "approve" && !isDocumentCurrent({ status: "approved", expires_on: document.expires_on }, kitchenToday())) {
    throw fail(409, "document_expired");
  }
  return only<DocumentRow>(tx, "UPDATE documents SET status = $2, review_note = $3 WHERE id = $1 RETURNING *", [documentId, to, note]);
}
