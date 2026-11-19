import { newId, type Queryable } from '../db.js';
import { serverNow } from './clock.js';
import type { LedgerAction, LedgerDetail } from '../../shared/types.js';
import type { LedgerRow } from './rows.js';

export interface LedgerWrite {
  actorId: string | null;
  action: LedgerAction;
  fileId?: string | null;
  folderId?: string | null;
  detail?: LedgerDetail;
}

export const writeLedger = async (tx: Queryable, entry: LedgerWrite): Promise<void> => {
  await tx.query(
    `INSERT INTO ledger (id, at, actor_id, action, file_id, folder_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId(),
      serverNow(),
      entry.actorId,
      entry.action,
      entry.fileId ?? null,
      entry.folderId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
};

export const fileEntries = async (tx: Queryable, fileId: string): Promise<LedgerRow[]> => {
  const { rows } = await tx.query<LedgerRow>(
    'SELECT id, at, actor_id, action, file_id, folder_id, detail FROM ledger WHERE file_id = $1 ORDER BY seq DESC LIMIT 200',
    [fileId],
  );
  return rows;
};

export const folderEntries = async (tx: Queryable, folderId: string): Promise<LedgerRow[]> => {
  const { rows } = await tx.query<LedgerRow>(
    `SELECT l.id, l.at, l.actor_id, l.action, l.file_id, l.folder_id, l.detail
       FROM ledger l
       LEFT JOIN files f ON f.id = l.file_id
      WHERE (l.folder_id = $1 AND (l.file_id IS NULL OR f.id IS NOT NULL)) OR f.folder_id = $1
      ORDER BY l.seq DESC LIMIT 200`,
    [folderId],
  );
  return rows;
};
