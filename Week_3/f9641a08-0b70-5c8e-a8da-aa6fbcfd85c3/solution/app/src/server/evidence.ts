import { createHash, randomUUID } from "node:crypto";
import type { Evidence } from "../shared/api";
import { one, rows, type Queryable, type Unit } from "./db";
import { FIELD, fail, tooLargeFile, validation } from "./errors";
import { config } from "./config";
import { putVerified, readObject } from "./storage";
import { detect, safeName } from "./sniff";
import type { Fields } from "./validate";

interface EvidenceRow {
  id: string;
  kind: "photo" | "receipt";
  filename: string;
  content_type: string;
  bytes: number;
  sha256: string;
  storage_key: string;
  stored_at: Date;
  claim_id: string | null;
}


interface UploadInput {
  kind: string;
  file: File | null;
}

export function readUpload(form: FormData | null): UploadInput {
  const kind = form?.get("kind");
  const file = form?.get("file");
  return { kind: typeof kind === "string" ? kind : "", file: file instanceof File ? file : null };
}

/** Checks the upload and returns the bytes; field errors, size and content are all decided before anything is stored. */
export async function checkUpload(input: UploadInput): Promise<{ bytes: Buffer; kind: "photo" | "receipt"; contentType: string; name: string }> {
  const fields: Fields = {};
  if (input.kind !== "photo" && input.kind !== "receipt") fields.kind = FIELD.evidenceKind;
  if (!input.file) fields.file = FIELD.file;
  if (!input.file || Object.keys(fields).length > 0) throw validation(fields);
  if (input.file.size > config.uploadMaxBytes) throw tooLargeFile(config.uploadMaxBytes);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const found = detect(bytes);
  if (!found || found.kind !== input.kind) throw fail("unsupported_file");
  return { bytes, kind: found.kind, contentType: found.contentType, name: safeName(input.file.name) };
}

/** Stores the object and, only once the storage service confirmed the exact size, the evidence record. */
export async function store(u: Unit, userId: string, upload: Awaited<ReturnType<typeof checkUpload>>, now: Date): Promise<Evidence> {
  const id = randomUUID();
  const key = `evidence/${userId}/${id}`;
  await putVerified(key, upload.bytes, upload.contentType, "evidence");
  const sha = createHash("sha256").update(upload.bytes).digest("hex");
  await u.db.query(
    `INSERT INTO evidence (id, user_id, kind, filename, content_type, bytes, sha256, storage_key, stored_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, upload.kind, upload.name, upload.contentType, upload.bytes.length, sha, key, now],
  );
  return { id, kind: upload.kind, filename: upload.name, content_type: upload.contentType, bytes: upload.bytes.length, sha256: sha, status: "stored", stored_at: now.toISOString() };
}

export async function ownEvidence(db: Queryable, id: string, userId?: string): Promise<EvidenceRow> {
  const row = /^[0-9a-f-]{36}$/.test(id)
    ? await one<EvidenceRow>(db, `SELECT id, kind, filename, content_type, bytes, sha256, storage_key, stored_at, claim_id FROM evidence WHERE id = $1 ${userId ? "AND user_id = $2" : ""}`, userId ? [id, userId] : [id])
    : null;
  if (!row) throw fail("not_found");
  return row;
}

export async function content(row: EvidenceRow): Promise<{ status: number; bytes: Buffer; contentType: string; headers: Record<string, string> }> {
  const bytes = await readObject(row.storage_key);
  if (!bytes) throw fail("not_found");
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" };
  if (row.kind === "receipt") headers["Content-Disposition"] = `attachment; filename="${row.filename.replace(/"/g, "")}"`;
  return { status: 200, bytes, contentType: row.content_type, headers };
}

export async function attachedTo(db: Queryable, claimId: string): Promise<{ id: string; kind: "photo" | "receipt"; filename: string; status: "stored" }[]> {
  const found = await rows<{ id: string; kind: "photo" | "receipt"; filename: string }>(db, "SELECT id, kind, filename FROM evidence WHERE claim_id = $1 ORDER BY stored_at, id", [claimId]);
  return found.map((e) => ({ ...e, status: "stored" as const }));
}
