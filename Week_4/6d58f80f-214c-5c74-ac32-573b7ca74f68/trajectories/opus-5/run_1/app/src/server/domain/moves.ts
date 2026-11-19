import { withTransaction, type Queryable } from '../db.js';
import { serverNow } from './clock.js';
import { writeLedger } from './ledger.js';
import type { AccessView } from './access.js';
import type { FileRow } from './rows.js';
import type { MoveResult, PersonRef } from '../../shared/types.js';

export interface MoveRequestItem {
  fileId: string;
  fromFolderId: string;
}

export interface MoveOutcome {
  result: MoveResult;
  movedFiles: { file: FileRow; fromFolderId: string }[];
}

const lastMover = async (tx: Queryable, fileId: string): Promise<string | null> => {
  const { rows } = await tx.query<{ actor_id: string | null }>(
    `SELECT actor_id FROM ledger WHERE file_id = $1 AND action = 'moved' ORDER BY seq DESC LIMIT 1`,
    [fileId],
  );
  return rows[0]?.actor_id ?? null;
};

const countsFor = async (
  tx: Queryable,
  folderIds: string[],
): Promise<Record<string, number>> => {
  if (folderIds.length === 0) return {};
  const { rows } = await tx.query<{ folder_id: string; n: number }>(
    `SELECT f.id AS folder_id,
            (SELECT count(*)::bigint FROM files WHERE folder_id = f.id AND state = 'live') AS n
       FROM folders f WHERE f.id = ANY($1::text[])`,
    [folderIds],
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.folder_id] = row.n;
  return out;
};

/**
 * Moves a selection into one folder. Locked files stay, files a rival move already took are
 * reported as lost, and the conditional update decides the single winner for each file.
 */
export const performMove = async (
  view: AccessView,
  actor: PersonRef,
  toFolderId: string,
  items: MoveRequestItem[],
): Promise<MoveOutcome> =>
  withTransaction(async (tx) => {
    const ids = items.map((item) => item.fileId);
    const { rows } = await tx.query<FileRow>(
      `SELECT id, name, folder_id, size, content_type, modified_at, locked, state
         FROM files WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
    const current = new Map(rows.map((row) => [row.id, row]));

    const moved: MoveResult['moved'] = [];
    const stayed: MoveResult['stayed'] = [];
    const lostTo: MoveResult['lostTo'] = [];
    const unchanged: string[] = [];
    const movedFiles: { file: FileRow; fromFolderId: string }[] = [];

    for (const item of items) {
      const file = current.get(item.fileId);
      if (file === undefined) continue;
      if (file.locked) {
        stayed.push({ fileId: file.id, reason: 'locked' });
        continue;
      }
      if (file.folder_id === toFolderId && item.fromFolderId === toFolderId) {
        unchanged.push(file.id);
        continue;
      }
      const updated = await tx.query<FileRow>(
        `UPDATE files SET folder_id = $1, modified_at = $2
           WHERE id = $3 AND folder_id = $4 AND state = 'live'
         RETURNING id, name, folder_id, size, content_type, modified_at, locked, state`,
        [toFolderId, serverNow(), file.id, item.fromFolderId],
      );
      const after = updated.rows[0];
      if (after === undefined) {
        const byId = await lastMover(tx, file.id);
        lostTo.push({
          fileId: file.id,
          folder: {
            id: view.folderRef(file.folder_id).id ?? '',
            name: view.folderRef(file.folder_id).name,
          },
          by: { id: byId ?? '', name: '' },
        });
        continue;
      }
      moved.push({ fileId: file.id, fromFolderId: item.fromFolderId });
      movedFiles.push({ file: after, fromFolderId: item.fromFolderId });
      await writeLedger(tx, {
        actorId: actor.id,
        action: 'moved',
        fileId: file.id,
        folderId: toFolderId,
        detail: {
          fileName: after.name,
          fromFolderId: item.fromFolderId,
          fromFolderName: view.folder(item.fromFolderId)?.name ?? '',
          toFolderId,
          toFolderName: view.folder(toFolderId)?.name ?? '',
        },
      });
    }

    const touched = new Set<string>([toFolderId, ...items.map((item) => item.fromFolderId)]);
    const folderCounts = await countsFor(tx, [...touched]);

    return {
      result: {
        toFolder: { id: toFolderId, name: view.folder(toFolderId)?.name ?? '' },
        moved,
        stayed,
        lostTo,
        unchanged,
        folderCounts,
      },
      movedFiles,
    };
  });
