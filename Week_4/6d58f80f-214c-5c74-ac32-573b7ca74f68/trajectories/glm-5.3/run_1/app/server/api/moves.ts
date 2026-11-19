import { ApiError } from '../http/respond.js';
import { pool, withTransaction } from '../db/pool.js';
import { now, toInstant, todayPhoenix } from '../domain/time.js';
import { recordLedger } from './ledger.js';
import { broadcast } from './events.js';
import { getFile, getFolder, effectiveFileAccess, effectiveFolderAccess, activeGrantTop } from './access.js';
import type { RouteContext } from './routes.js';

export async function handleMoveCompute(ctx: RouteContext, person: import('../domain/types.js').Person): Promise<Record<string, unknown>> {
  const body = ctx.body ?? {};
  const toFolderId = body['toFolderId'];
  const items = body['items'];
  if (typeof toFolderId !== 'string' || !Array.isArray(items) || items.length < 1 || items.length > 500) {
    throw new ApiError('validation', { items: 'Choose between 1 and 500 items.' });
  }
  const seen = new Set<string>();
  const parsed: Array<{ fileId: string; fromFolderId: string }> = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) throw new ApiError('validation', { items: 'Choose files to move.' });
    const fileId = (item as Record<string, unknown>)['fileId'];
    const fromFolderId = (item as Record<string, unknown>)['fromFolderId'];
    if (typeof fileId !== 'string' || typeof fromFolderId !== 'string') throw new ApiError('validation', { items: 'Choose files to move.' });
    if (seen.has(fileId)) throw new ApiError('validation', { items: 'Choose distinct files.' });
    seen.add(fileId);
    parsed.push({ fileId, fromFolderId });
  }

  const result = await withTransaction(async (client) => {
    const dest = await getFolder(client, toFolderId);
    if (!dest) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const destRole = await effectiveFolderAccess(client, person, toFolderId, grants);
    if (!destRole) throw new ApiError('not_found');
    if (destRole !== 'editor') throw new ApiError('forbidden');

    const moved: Array<{ fileId: string; fromFolderId: string }> = [];
    const stayed: Array<{ fileId: string; reason: 'locked' }> = [];
    const lostTo: Array<{ fileId: string; folder: { id: string | null; name: string }; by: { id: string; name: string } }> = [];
    const unchanged: string[] = [];
    const touchedFolders = new Set<string>([toFolderId]);

    for (const item of parsed) {
      const file = await getFile(client, item.fileId);
      if (!file || file.inBin) { throw new ApiError('not_found'); }
      const fileRole = await effectiveFileAccess(client, person, file, grants);
      if (!fileRole) throw new ApiError('not_found');
      if (item.fromFolderId !== toFolderId) {
        const srcRole = item.fromFolderId ? await effectiveFolderAccess(client, person, item.fromFolderId, grants) : null;
        if (person.kind === 'partner' && (!srcRole || srcRole !== 'editor')) throw new ApiError('not_found');
      }
      if (file.locked) {
        stayed.push({ fileId: item.fileId, reason: 'locked' });
        continue;
      }
      if (file.folderId === toFolderId && item.fromFolderId === toFolderId) {
        unchanged.push(item.fileId);
        continue;
      }
      if (file.folderId !== item.fromFolderId) {
        const currentFolder = file.folderId ? await getFolder(client, file.folderId) : null;
        const moverRes = await client.query<{ actor_name: string; actor_id: string }>(
          `SELECT actor_id, actor_name FROM ledger WHERE action = 'moved' AND file_id = $1 ORDER BY at DESC LIMIT 1`,
          [item.fileId],
        );
        const mover = moverRes.rows[0];
        const visibleToCaller = person.kind === 'staff' || (currentFolder ? (await effectiveFolderAccess(client, person, currentFolder.id, grants)) !== null : false);
        lostTo.push({
          fileId: item.fileId,
          folder: visibleToCaller && currentFolder ? { id: currentFolder.id, name: currentFolder.name } : { id: null, name: 'another folder' },
          by: { id: mover?.actor_id ?? '', name: mover?.actor_name ?? 'Someone' },
        });
        continue;
      }
      const update = await client.query(
        'UPDATE files SET folder_id = $2, modified_at = $3, last_activity = $3 WHERE id = $1 AND folder_id = $4 AND locked = false RETURNING id',
        [item.fileId, toFolderId, toInstant(now()), item.fromFolderId],
      );
      if ((update.rowCount ?? 0) === 0) {
        const currentFolder = file.folderId ? await getFolder(client, file.folderId) : null;
        const moverRes = await client.query<{ actor_name: string; actor_id: string }>(
          `SELECT actor_id, actor_name FROM ledger WHERE action = 'moved' AND file_id = $1 ORDER BY at DESC LIMIT 1`,
          [item.fileId],
        );
        const mover = moverRes.rows[0];
        const visibleToCaller = person.kind === 'staff' || (currentFolder ? (await effectiveFolderAccess(client, person, currentFolder.id, grants)) !== null : false);
        lostTo.push({
          fileId: item.fileId,
          folder: visibleToCaller && currentFolder ? { id: currentFolder.id, name: currentFolder.name } : { id: null, name: 'another folder' },
          by: { id: mover?.actor_id ?? '', name: mover?.actor_name ?? 'Someone' },
        });
        continue;
      }
      moved.push(item);
      touchedFolders.add(item.fromFolderId);
      const destFolderName = dest.name;
      await recordLedger(client, { id: person.id, name: person.name }, 'moved', item.fileId, toFolderId, {
        fileName: file.name, toFolder: destFolderName, fromFolder: item.fromFolderId, byPerson: person.name,
      });
    }

    const folderCounts: Record<string, number> = {};
    for (const fid of touchedFolders) {
      const countRes = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM files WHERE folder_id = $1 AND in_bin = false AND purged = false',
        [fid],
      );
      folderCounts[fid] = Number(countRes.rows[0]?.count ?? 0);
    }
    return { toFolder: { id: dest.id, name: dest.name }, moved, stayed, lostTo, unchanged, folderCounts };
  });

  broadcast({
    type: 'files_moved',
    data: { ...result, actorId: person.id, actorName: person.name },
  });
  return result;
}
