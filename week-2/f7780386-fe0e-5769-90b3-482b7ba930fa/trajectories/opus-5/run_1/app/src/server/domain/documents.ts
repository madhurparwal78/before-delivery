import type { DocumentKind, DocumentRecord, DocumentStatus } from '../../shared/api.js';
import { documentCoversDate, documentHasExpired } from '../../shared/domain.js';
import { formatInstant } from '../../shared/time.js';
import type { Queryable } from './kitchen.js';

export interface DocumentRow {
  id: string;
  member_id: string;
  kind: DocumentKind;
  crew_cook_id: string | null;
  crew_cook_name: string | null;
  expires_on: string;
  status: DocumentStatus;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
}

const DOCUMENT_COLUMNS = `d.id, d.member_id, d.kind, d.crew_cook_id, u.name AS crew_cook_name,
  d.expires_on, d.status, d.filename, d.content_type, d.size_bytes, d.storage_key,
  d.uploaded_at, d.reviewed_at, d.rejection_reason`;

const DOCUMENT_FROM = `FROM documents d LEFT JOIN users u ON u.id = d.crew_cook_id`;

/** An approved document reads `expired` once its validity has ended. */
export function effectiveStatus(row: DocumentRow, today: string): DocumentStatus {
  if (row.status === 'approved' && documentHasExpired(row.expires_on, today)) return 'expired';
  return row.status;
}

export function documentView(row: DocumentRow, today: string, timeZone: string): DocumentRecord {
  return {
    id: row.id,
    member_id: row.member_id,
    kind: row.kind,
    crew_cook_id: row.crew_cook_id,
    crew_cook_name: row.crew_cook_name,
    expires_on: row.expires_on,
    status: effectiveStatus(row, today),
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: formatInstant(row.uploaded_at, timeZone),
    reviewed_at: row.reviewed_at === null ? null : formatInstant(row.reviewed_at, timeZone),
    rejection_reason: row.rejection_reason,
  };
}

export async function findDocument(db: Queryable, id: string): Promise<DocumentRow | null> {
  const result = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} WHERE d.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listDocuments(
  db: Queryable,
  scope: { memberId?: string; crewCookId?: string },
): Promise<DocumentRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scope.memberId !== undefined) {
    params.push(scope.memberId);
    conditions.push(`d.member_id = $${params.length}`);
  }
  if (scope.crewCookId !== undefined) {
    params.push(scope.crewCookId);
    conditions.push(`d.crew_cook_id = $${params.length}`);
  }
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const result = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} ${where} ORDER BY d.uploaded_at DESC, d.id`,
    params,
  );
  return result.rows;
}

/** The member's liability insurance must be approved and cover the date. */
export async function insuranceCoversDate(
  db: Queryable,
  memberId: string,
  date: string,
): Promise<boolean> {
  const result = await db.query<{ expires_on: string }>(
    `SELECT expires_on FROM documents
      WHERE member_id = $1 AND kind = 'liability_insurance' AND status = 'approved'`,
    [memberId],
  );
  return result.rows.some((row) => documentCoversDate(row.expires_on, date));
}

/** The crew cook's own approved food handler card covering the booking date. */
export async function foodHandlerCardFor(
  db: Queryable,
  crewCookId: string,
  date: string,
): Promise<string | null> {
  const result = await db.query<{ id: string; expires_on: string }>(
    `SELECT id, expires_on FROM documents
      WHERE crew_cook_id = $1 AND kind = 'food_handler_card' AND status = 'approved'
      ORDER BY expires_on DESC`,
    [crewCookId],
  );
  const covering = result.rows.find((row) => documentCoversDate(row.expires_on, date));
  return covering?.id ?? null;
}

/** The member's insurance as shown on the operator's members table. */
export async function insuranceSummary(
  db: Queryable,
  memberId: string,
  today: string,
): Promise<{ status: DocumentStatus; expires_on: string } | null> {
  const result = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM}
      WHERE d.member_id = $1 AND d.kind = 'liability_insurance'
      ORDER BY (d.status = 'approved') DESC, d.expires_on DESC
      LIMIT 1`,
    [memberId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { status: effectiveStatus(row, today), expires_on: row.expires_on };
}

export type DetectedType = 'application/pdf' | 'image/png' | 'image/jpeg' | null;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The file's type is judged by its first bytes, never by its name. */
export function detectContentType(bytes: Buffer): DetectedType {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export function isAcceptableFilename(name: string): boolean {
  if (name.length === 0 || name.length > 120) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return !/[\u0000-\u001f\u007f]/.test(name);
}
