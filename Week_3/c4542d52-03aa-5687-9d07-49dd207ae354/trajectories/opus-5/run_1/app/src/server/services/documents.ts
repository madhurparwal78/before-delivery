import type { DocumentKind, DocumentRecord } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { nextDocumentId } from "../ids.js";
import { sealObject } from "./vault.js";

export { grantAgreementText, exerciseNoticeText, tenderNdaText } from "../../shared/documents.js";

export interface DocumentRow {
  id: string;
  kind: DocumentKind;
  title: string;
  owner_id: string;
  status: "pending" | "sealed";
  sha256: string | null;
  vault_key: string;
  body: string;
  created_at: Date;
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
}

export const DOCUMENT_COLUMNS = `id, kind, title, owner_id, status, sha256, vault_key, body,
  created_at, version, supersedes, superseded_by`;

export function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    owner_id: row.owner_id,
    status: row.status,
    sha256: row.sha256,
    vault_key: row.vault_key,
    created_at: row.created_at.toISOString(),
    version: row.version,
    supersedes: row.supersedes,
    superseded_by: row.superseded_by,
  };
}

export interface NewDocument {
  kind: DocumentKind;
  title: string;
  ownerId: string;
  vaultKey: string;
  body: string;
  grantId?: string;
  orderId?: string;
  tenderId?: string;
}

/** Creates the pending document record, or returns the one already recorded. */
export async function recordPendingDocument(
  tx: Transaction,
  existingId: string | null,
  document: NewDocument,
): Promise<DocumentRow> {
  if (existingId !== null) {
    const existing = await tx.queryOne<DocumentRow>(`select ${DOCUMENT_COLUMNS} from documents where id = $1`, [
      existingId,
    ]);
    if (existing !== null) return existing;
  }
  const id = await nextDocumentId(tx);
  const rows = await tx.query<DocumentRow>(
    `insert into documents (id, kind, title, owner_id, status, sha256, vault_key, body, grant_id, order_id, tender_id)
     values ($1, $2, $3, $4, 'pending', null, $5, $6, $7, $8, $9)
     returning ${DOCUMENT_COLUMNS}`,
    [
      id,
      document.kind,
      document.title,
      document.ownerId,
      document.vaultKey,
      document.body,
      document.grantId ?? null,
      document.orderId ?? null,
      document.tenderId ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("the document record was not written");
  return row;
}

/** Writes the bytes to the vault, reads them back and marks the document sealed. */
export async function sealDocument(tx: Transaction, row: DocumentRow): Promise<string> {
  const hash = await sealObject(row.vault_key, row.body);
  await tx.query("update documents set status = 'sealed', sha256 = $2 where id = $1", [row.id, hash]);
  return hash;
}
