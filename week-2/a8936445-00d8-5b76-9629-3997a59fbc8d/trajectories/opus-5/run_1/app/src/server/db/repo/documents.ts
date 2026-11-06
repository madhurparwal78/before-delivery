import { pool, type Queryable } from '../pool.js';
import type { DocumentKind } from '../../domain/constants.js';
import type { DocumentRecord } from '../../domain/types.js';

interface DocumentRow {
  id: string;
  tenant_id: string;
  kind: DocumentKind;
  holder_name: string | null;
  expires_on: string;
  status: 'pending_review' | 'approved' | 'rejected';
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
}

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    holderName: row.holder_name,
    expiresOn: row.expires_on,
    status: row.status,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    storageKey: row.storage_key,
    uploadedAt: row.uploaded_at,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
  };
}

const COLUMNS =
  'id, tenant_id, kind, holder_name, expires_on, status, file_name, content_type, size_bytes, storage_key, uploaded_at, reviewed_at, rejection_reason';

export async function listDocuments(tenantId: string | null): Promise<DocumentRecord[]> {
  const result = tenantId
    ? await pool.query<DocumentRow>(
        `SELECT ${COLUMNS} FROM documents WHERE tenant_id = $1 ORDER BY uploaded_at DESC, id`,
        [tenantId],
      )
    : await pool.query<DocumentRow>(
        `SELECT ${COLUMNS} FROM documents ORDER BY uploaded_at DESC, id`,
      );
  return result.rows.map(toDocument);
}

export async function findDocument(id: string): Promise<DocumentRecord | null> {
  const result = await pool.query<DocumentRow>(`SELECT ${COLUMNS} FROM documents WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toDocument(row) : null;
}

export async function insertDocument(document: DocumentRecord, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO documents (id, tenant_id, kind, holder_name, expires_on, status, file_name,
       content_type, size_bytes, storage_key, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      document.id,
      document.tenantId,
      document.kind,
      document.holderName,
      document.expiresOn,
      document.status,
      document.fileName,
      document.contentType,
      document.sizeBytes,
      document.storageKey,
      document.uploadedAt,
    ],
  );
}

export async function setDocumentReview(
  id: string,
  status: 'approved' | 'rejected',
  reviewedAt: Date,
  rejectionReason: string | null,
  db: Queryable = pool,
): Promise<void> {
  await db.query(
    'UPDATE documents SET status = $2, reviewed_at = $3, rejection_reason = $4 WHERE id = $1',
    [id, status, reviewedAt, rejectionReason],
  );
}

export async function claimReminderDocuments(
  today: string,
  leadDays: number,
): Promise<DocumentRecord[]> {
  const result = await pool.query<DocumentRow>(
    `UPDATE documents SET reminder_sent_at = now()
      WHERE id IN (
        SELECT d.id FROM documents d
         WHERE d.status = 'approved'
           AND d.reminder_sent_at IS NULL
           AND d.expires_on >= $1::date
           AND d.expires_on <= ($1::date + $2::int)
           AND NOT EXISTS (
             SELECT 1 FROM documents later
              WHERE later.tenant_id = d.tenant_id
                AND later.kind = d.kind
                AND later.status = 'approved'
                AND later.expires_on > d.expires_on
                AND (d.kind <> 'food_handler_card' OR later.holder_name IS NOT DISTINCT FROM d.holder_name)
           )
      )
      RETURNING ${COLUMNS}`,
    [today, leadDays],
  );
  return result.rows.map(toDocument);
}

export async function undoReminderClaim(id: string): Promise<void> {
  await pool.query('UPDATE documents SET reminder_sent_at = NULL WHERE id = $1', [id]);
}

export async function listSeedDocumentsNeedingFiles(): Promise<
  { id: string; storageKey: string; contentType: string; pdf: Buffer }[]
> {
  const result = await pool.query<{
    id: string;
    storage_key: string;
    content_type: string;
    seed_pdf: Buffer;
  }>('SELECT id, storage_key, content_type, seed_pdf FROM documents WHERE seed_pdf IS NOT NULL');
  return result.rows.map((row) => ({
    id: row.id,
    storageKey: row.storage_key,
    contentType: row.content_type,
    pdf: row.seed_pdf,
  }));
}

export async function clearSeedPdf(id: string): Promise<void> {
  await pool.query('UPDATE documents SET seed_pdf = NULL WHERE id = $1', [id]);
}
