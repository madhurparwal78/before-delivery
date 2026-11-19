import { db, withTransaction, type Queryable } from '../db.js';
import { reached, startOfCompanyDay, today } from './clock.js';
import { writeLedger } from './ledger.js';
import { daysInForce } from './policies.js';
import { deleteObject } from '../services/storage.js';
import type { BinRow, FileRow } from './rows.js';

export interface BinOutcome {
  binned: string[];
  stayed: { fileId: string; reason: 'locked' }[];
}

export const binFiles = async (actorId: string, fileIds: string[]): Promise<BinOutcome> =>
  withTransaction(async (tx) => {
    const { rows } = await tx.query<FileRow>(
      `SELECT id, name, folder_id, size, content_type, modified_at, locked, state
         FROM files WHERE id = ANY($1::text[]) AND state = 'live' ORDER BY id FOR UPDATE`,
      [fileIds],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const binnedDate = today();
    const retentionDays = await daysInForce('bin_retention_days', binnedDate, tx);
    const purgeDate = new Date(
      new Date(`${binnedDate}T00:00:00.000Z`).getTime() + retentionDays * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    const binned: string[] = [];
    const stayed: BinOutcome['stayed'] = [];
    for (const fileId of fileIds) {
      const file = byId.get(fileId);
      if (file === undefined) continue;
      if (file.locked) {
        stayed.push({ fileId, reason: 'locked' });
        continue;
      }
      await tx.query(`UPDATE files SET state = 'binned' WHERE id = $1`, [fileId]);
      await tx.query(
        `INSERT INTO bin_items (file_id, from_folder_id, binned_date, retention_days, purge_date)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (file_id) DO UPDATE SET
           from_folder_id = EXCLUDED.from_folder_id, binned_date = EXCLUDED.binned_date,
           retention_days = EXCLUDED.retention_days, purge_date = EXCLUDED.purge_date`,
        [fileId, file.folder_id, binnedDate, retentionDays, purgeDate],
      );
      await writeLedger(tx, {
        actorId,
        action: 'binned',
        fileId,
        folderId: file.folder_id,
        detail: { fileName: file.name, folderName: '' },
      });
      binned.push(fileId);
    }
    return { binned, stayed };
  });

export const restoreFile = async (
  actorId: string,
  fileId: string,
): Promise<{ file: FileRow; folderName: string }> =>
  withTransaction(async (tx) => {
    const { rows } = await tx.query<BinRow>('SELECT * FROM bin_items WHERE file_id = $1', [fileId]);
    const bin = rows[0];
    if (bin === undefined) throw new Error('restoring a file that is not binned');
    const updated = await tx.query<FileRow>(
      `UPDATE files SET state = 'live', folder_id = $2 WHERE id = $1
       RETURNING id, name, folder_id, size, content_type, modified_at, locked, state`,
      [fileId, bin.from_folder_id],
    );
    const file = updated.rows[0];
    if (file === undefined) throw new Error('restoring a file that no longer exists');
    await tx.query('DELETE FROM bin_items WHERE file_id = $1', [fileId]);
    const folder = await tx.query<{ name: string }>('SELECT name FROM folders WHERE id = $1', [
      bin.from_folder_id,
    ]);
    const folderName = folder.rows[0]?.name ?? '';
    await writeLedger(tx, {
      actorId,
      action: 'restored',
      fileId,
      folderId: bin.from_folder_id,
      detail: { fileName: file.name, folderName },
    });
    return { file, folderName };
  });

export interface PurgeOutcome {
  fileId: string;
  name: string;
  folderId: string;
  grantHolders: { personId: string; itemName: string }[];
}

/**
 * Removes the object, then the row, its grants and its folder count, in one step.
 * Used both by the scheduled purge and by delete forever.
 */
export const purgeFile = async (
  actorId: string | null,
  fileId: string,
): Promise<PurgeOutcome> => {
  await deleteObject(fileId);
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<FileRow>(
      `SELECT id, name, folder_id, size, content_type, modified_at, locked, state
         FROM files WHERE id = $1 FOR UPDATE`,
      [fileId],
    );
    const file = rows[0];
    if (file === undefined) throw new Error('purging a file that no longer exists');
    const binned = await tx.query<{ from_folder_id: string }>(
      'SELECT from_folder_id FROM bin_items WHERE file_id = $1',
      [fileId],
    );
    const holders = await tx.query<{ person_id: string }>(
      `SELECT person_id FROM grants WHERE item_type = 'file' AND item_id = $1 AND status = 'active'`,
      [fileId],
    );
    await tx.query(
      `UPDATE grants SET status = 'ended', ended_reason = 'purged'
         WHERE item_type = 'file' AND item_id = $1 AND status = 'active'`,
      [fileId],
    );
    const folderId = binned.rows[0]?.from_folder_id ?? file.folder_id;
    await tx.query('DELETE FROM bin_items WHERE file_id = $1', [fileId]);
    await tx.query('DELETE FROM files WHERE id = $1', [fileId]);
    await writeLedger(tx, {
      actorId,
      action: 'purged',
      fileId: null,
      folderId,
      detail: { fileName: file.name },
    });
    return {
      fileId,
      name: file.name,
      folderId,
      grantHolders: holders.rows.map((row) => ({
        personId: row.person_id,
        itemName: file.name,
      })),
    };
  });
};

export const binRows = async (tx: Queryable = db): Promise<{ bin: BinRow; file: FileRow }[]> => {
  const { rows } = await tx.query<BinRow & FileRow>(
    `SELECT b.file_id, b.from_folder_id, b.binned_date, b.retention_days, b.purge_date,
            f.id, f.name, f.folder_id, f.size, f.content_type, f.modified_at, f.locked, f.state
       FROM bin_items b JOIN files f ON f.id = b.file_id
      ORDER BY b.purge_date ASC, f.name ASC`,
  );
  return rows.map((row) => ({
    bin: {
      file_id: row.file_id,
      from_folder_id: row.from_folder_id,
      binned_date: row.binned_date,
      retention_days: row.retention_days,
      purge_date: row.purge_date,
    },
    file: {
      id: row.id,
      name: row.name,
      folder_id: row.folder_id,
      size: row.size,
      content_type: row.content_type,
      modified_at: row.modified_at,
      locked: row.locked,
      state: row.state,
    },
  }));
};

export const purgeIsDue = (purgeDate: string): boolean => reached(startOfCompanyDay(purgeDate));
