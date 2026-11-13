import { type Db, LIVE_CHANNEL } from "../db.js";
import { notFound } from "../errors.js";
import { isUuid } from "../util.js";
import type { DocumentStatus, Delivery, FieldKind, PageSize, RecipientStatus, Role, Stroke } from "../../shared/types.js";

export interface DocumentRow {
  id: string;
  team_id: string;
  owner_id: string;
  title: string;
  status: DocumentStatus;
  time_zone: string;
  page_count: number;
  page_sizes: PageSize[];
  original_sha256: string;
  completed_sha256: string | null;
  version: number;
  current_order: number | null;
  reminder_available_at: Date | null;
  reminder_expiry_pushed: boolean;
  seal_next_attempt_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RecipientRow {
  id: string;
  document_id: string;
  name: string;
  email: string;
  signing_order: number;
  status: RecipientStatus;
  delivery: Delivery | null;
  link_expires_at: Date | null;
  signed_at: Date | null;
  decline_reason: string | null;
}

export interface FieldRow {
  id: string;
  document_id: string;
  recipient_id: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  strokes: Stroke[] | null;
}

export interface UserRow {
  id: string;
  team_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
}

export async function lockDocument(db: Db, documentId: string, teamId: string): Promise<DocumentRow> {
  if (!isUuid(documentId)) throw notFound();
  const { rows } = await db.query<DocumentRow>("SELECT * FROM documents WHERE id = $1 AND team_id = $2 FOR UPDATE", [documentId, teamId]);
  const row = rows[0];
  if (!row) throw notFound();
  return row;
}

export async function readDocument(db: Db, documentId: string, teamId: string): Promise<DocumentRow> {
  if (!isUuid(documentId)) throw notFound();
  const { rows } = await db.query<DocumentRow>("SELECT * FROM documents WHERE id = $1 AND team_id = $2", [documentId, teamId]);
  const row = rows[0];
  if (!row) throw notFound();
  return row;
}

export async function recipientsOf(db: Db, documentId: string): Promise<RecipientRow[]> {
  const { rows } = await db.query<RecipientRow>("SELECT * FROM recipients WHERE document_id = $1 ORDER BY signing_order", [documentId]);
  return rows;
}

export async function fieldsOf(db: Db, documentId: string): Promise<FieldRow[]> {
  const { rows } = await db.query<FieldRow>("SELECT * FROM fields WHERE document_id = $1 ORDER BY created_seq", [documentId]);
  return rows;
}

export async function ownerOf(db: Db, ownerId: string): Promise<UserRow> {
  const { rows } = await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [ownerId]);
  const row = rows[0];
  if (!row) throw notFound();
  return row;
}

export async function touchDocument(db: Db, document: DocumentRow): Promise<void> {
  await db.query("UPDATE documents SET version = version + 1, updated_at = now() WHERE id = $1", [document.id]);
  await announce(db, { type: "document", documentId: document.id, teamId: document.team_id });
}

export async function announce(db: Db, payload: Record<string, string>): Promise<void> {
  await db.query("SELECT pg_notify($1, $2)", [LIVE_CHANNEL, JSON.stringify(payload)]);
}
