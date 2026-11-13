import { now } from "../clock";
import { config } from "../config";
import { newId, type Db, type TxHandle } from "../db";
import { apiErrors } from "../http/errors";
import { putObject, StorageUnavailable } from "../s3";
import { emitIdReview } from "./events";
import { emails } from "./emails";
import { enqueue } from "./outbox";
import type { MemberRow } from "./views";

export type FileKind = "photo" | "id_document";

const SIGNATURES: { type: string; matches: (head: Buffer) => boolean }[] = [
  { type: "image/png", matches: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/jpeg", matches: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  { type: "application/pdf", matches: (h) => h.subarray(0, 5).toString("latin1") === "%PDF-" },
];

const ALLOWED: Record<FileKind, string[]> = {
  photo: ["image/png", "image/jpeg"],
  id_document: ["image/png", "image/jpeg", "application/pdf"],
};

/** The type is judged by the leading bytes, never by name or header. */
export function sniff(data: Buffer, kind: FileKind): string {
  const found = SIGNATURES.find((s) => s.matches(data));
  if (!found || !ALLOWED[kind].includes(found.type)) throw apiErrors.fileType(kind);
  return found.type;
}

export function checkSize(data: Buffer, kind: FileKind): void {
  const limit = kind === "photo" ? config.photoMaxBytes : config.idDocMaxBytes;
  if (data.length > limit) throw apiErrors.fileTooLarge(limit);
}

/** Store the object in MinIO first; the file counts as uploaded only after MinIO confirms it. */
export async function storeFile(db: TxHandle, member: MemberRow, kind: FileKind, data: Buffer, contentType: string): Promise<{ fileId: string; documentId: string | null }> {
  const fileId = newId();
  const folder = kind === "photo" ? "photos" : "id-documents";
  const key = `${folder}/${member.id}/${fileId}`;
  try {
    await putObject(key, data, contentType);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw apiErrors.storageUnavailable();
    throw error;
  }
  const at = now();
  await db.query("INSERT INTO files (id, owner_id, kind, object_key, content_type, size_bytes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [fileId, member.id, kind, key, contentType, data.length, at]);
  if (kind === "photo") {
    await db.query("UPDATE members SET photo_file_id = $2 WHERE id = $1", [member.id, fileId]);
    return { fileId, documentId: null };
  }
  const documentId = newId();
  await db.query("UPDATE id_documents SET state = 'replaced' WHERE member_id = $1 AND state = 'pending'", [member.id]);
  await db.query("INSERT INTO id_documents (id, member_id, file_id, state, uploaded_at) VALUES ($1, $2, $3, 'pending', $4)", [documentId, member.id, fileId, at]);
  await db.query("UPDATE members SET id_state = 'pending', id_reason = NULL WHERE id = $1", [member.id]);
  return { fileId, documentId };
}

interface FileRow {
  id: string;
  owner_id: string;
  kind: FileKind;
  object_key: string;
  content_type: string;
}

export async function fileById(db: Db, id: string): Promise<FileRow | undefined> {
  const { rows } = await db.query<FileRow>("SELECT id, owner_id, kind, object_key, content_type FROM files WHERE id = $1", [id]);
  return rows[0];
}

export async function currentDocument(db: Db, memberId: string): Promise<{ id: string; file_id: string; state: string; reason: string | null } | undefined> {
  const { rows } = await db.query<{ id: string; file_id: string; state: string; reason: string | null }>(
    "SELECT id, file_id, state, reason FROM id_documents WHERE member_id = $1 AND state <> 'replaced' ORDER BY seq DESC LIMIT 1",
    [memberId],
  );
  return rows[0];
}

interface PendingDocument {
  id: string;
  member_id: string;
  file_id: string;
  uploaded_at: Date;
}

export async function pendingDocuments(db: Db): Promise<PendingDocument[]> {
  const { rows } = await db.query<PendingDocument>("SELECT id, member_id, file_id, uploaded_at FROM id_documents WHERE state = 'pending' ORDER BY seq");
  return rows;
}

export async function documentById(db: Db, id: string, lock = false): Promise<(PendingDocument & { state: string }) | undefined> {
  const { rows } = await db.query<PendingDocument & { state: string }>(`SELECT id, member_id, file_id, uploaded_at, state FROM id_documents WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0];
}

/** The founder's decision: verified, or please upload again with a reason. */
export async function decideDocument(db: TxHandle, document: PendingDocument, member: MemberRow, reason: string | null): Promise<void> {
  const at = now();
  if (reason === null) {
    await db.query("UPDATE id_documents SET state = 'approved', decided_at = $2 WHERE id = $1", [document.id, at]);
    await db.query("UPDATE members SET id_state = 'verified', id_reason = NULL WHERE id = $1", [member.id]);
    await enqueue(db, emails.idVerified(member.email, member.display_name));
  } else {
    await db.query("UPDATE id_documents SET state = 'rejected', reason = $2, decided_at = $3 WHERE id = $1", [document.id, reason, at]);
    await db.query("UPDATE members SET id_state = 'rejected', id_reason = $2 WHERE id = $1", [member.id, reason]);
    await enqueue(db, emails.idRejected(member.email, member.display_name, reason));
  }
  db.afterCommit(() => emitIdReview(member.id));
}
