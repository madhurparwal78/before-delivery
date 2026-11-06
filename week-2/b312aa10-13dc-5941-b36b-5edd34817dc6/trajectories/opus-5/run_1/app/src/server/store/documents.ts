import { randomUUID } from 'node:crypto';
import type { DocumentStatus, DocumentType } from '../../shared/format.js';
import type { Queryable } from '../db/pool.js';
import type { DocumentRow } from '../domain/types.js';

type Row = {
  id: string;
  seq: string;
  kitchen_id: string;
  member_id: string;
  type: DocumentType;
  expiry_date: string;
  status: DocumentStatus;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: Date;
  approved_at: Date | null;
  version: number;
  object_pending: boolean;
};

const columns = `id, seq, kitchen_id, member_id, type, expiry_date, status, file_name,
                 content_type, size_bytes, uploaded_at, approved_at, version, object_pending`;

function toDocument(row: Row): DocumentRow {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    memberId: row.member_id,
    type: row.type,
    expiryDate: row.expiry_date,
    status: row.status,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAtMs: row.uploaded_at.getTime(),
    approvedAtMs: row.approved_at ? row.approved_at.getTime() : null,
    version: row.version,
    objectPending: row.object_pending,
    seq: String(row.seq),
  };
}

/** Newest upload first; ties follow the seed order. */
export async function listDocuments(
  client: Queryable,
  kitchenId: string,
  memberId: string | null,
): Promise<DocumentRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from documents
      where kitchen_id = $1 and ($2::text is null or member_id = $2)
      order by uploaded_at desc, seq asc`,
    [kitchenId, memberId],
  );
  return result.rows.map(toDocument);
}

export async function loadDocument(
  client: Queryable,
  kitchenId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const result = await client.query<Row>(
    `select ${columns} from documents where id = $1 and kitchen_id = $2`,
    [documentId, kitchenId],
  );
  const row = result.rows[0];
  return row ? toDocument(row) : null;
}

export async function memberDocumentsOfType(
  client: Queryable,
  memberId: string,
  type: DocumentType,
): Promise<DocumentRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from documents where member_id = $1 and type = $2 order by seq`,
    [memberId, type],
  );
  return result.rows.map(toDocument);
}

export async function memberDocuments(
  client: Queryable,
  memberId: string,
): Promise<DocumentRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from documents where member_id = $1 order by seq`,
    [memberId],
  );
  return result.rows.map(toDocument);
}

export function newDocumentId(): string {
  return `doc_${randomUUID()}`;
}

export async function insertDocument(
  client: Queryable,
  document: {
    id: string;
    kitchenId: string;
    memberId: string;
    type: DocumentType;
    expiryDate: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    uploadedAtMs: number;
  },
): Promise<DocumentRow> {
  const result = await client.query<Row>(
    `insert into documents (id, kitchen_id, member_id, type, expiry_date, status, file_name,
                            content_type, size_bytes, uploaded_at, version)
     values ($1,$2,$3,$4,$5,'submitted',$6,$7,$8,$9,1) returning ${columns}`,
    [
      document.id,
      document.kitchenId,
      document.memberId,
      document.type,
      document.expiryDate,
      document.fileName,
      document.contentType,
      document.sizeBytes,
      new Date(document.uploadedAtMs).toISOString(),
    ],
  );
  return toDocument(result.rows[0]!);
}

export async function supersedeOlderSubmitted(
  client: Queryable,
  memberId: string,
  type: DocumentType,
  keepId: string,
): Promise<void> {
  await client.query(
    `update documents set status = 'superseded', version = version + 1
      where member_id = $1 and type = $2 and status = 'submitted' and id <> $3`,
    [memberId, type, keepId],
  );
}

export async function approveDocument(
  client: Queryable,
  documentId: string,
  approvedAtMs: number,
): Promise<DocumentRow> {
  const result = await client.query<Row>(
    `update documents set status = 'approved', approved_at = $2, version = version + 1
      where id = $1 returning ${columns}`,
    [documentId, new Date(approvedAtMs).toISOString()],
  );
  return toDocument(result.rows[0]!);
}

export async function deleteDocument(client: Queryable, documentId: string): Promise<void> {
  await client.query(`delete from documents where id = $1`, [documentId]);
}

export async function noticeSent(
  client: Queryable,
  documentId: string,
  kind: '14' | '3',
): Promise<boolean> {
  const result = await client.query(
    `insert into document_notices (document_id, kind) values ($1,$2)
     on conflict (document_id, kind) do nothing`,
    [documentId, kind],
  );
  return (result.rowCount ?? 0) > 0;
}
