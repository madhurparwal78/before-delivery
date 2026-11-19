import pg from 'pg';
import type { Person, Role, FileRow, Folder } from '../domain/types.js';
import {
  getFolder, getFile, activeGrantTop, effectiveFolderAccess, effectiveFileAccess,
  fileAccessEndDate,
} from './access.js';
import { todayPhoenix, now } from '../domain/time.js';

const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'application/pdf']);
const HIDDEN = { id: null, name: 'another folder' };

export interface FileDbRow {
  id: string;
  name: string;
  folderId: string | null;
  size: number;
  contentType: string;
  modifiedAt: string;
  locked: boolean;
  inBin: boolean;
  lastActivity: string;
}

export async function serializeFile(client: pg.PoolClient, person: Person, file: FileDbRow): Promise<FileRow> {
  const grants = await activeGrantTop(client, person.id);
  const access = await effectiveFileAccess(client, person, file, grants);
  const folder = file.folderId ? await getFolder(client, file.folderId) : null;
  const isPartner = person.kind === 'partner';
  const folderVisible = !isPartner || (file.folderId !== null && grants.has(`folder:${file.folderId}`));
  const folderName = isPartner && !folderVisible ? 'another folder' : (folder?.name ?? '');
  const accessEnds = isPartner ? await fileAccessEndDate(client, person, file) : null;
  const modified = file.modifiedAt;
  return {
    id: file.id,
    name: file.name,
    folderId: isPartner && !folderVisible ? null : file.folderId,
    folderName,
    size: file.size,
    contentType: file.contentType,
    modifiedAt: modified,
    locked: file.locked,
    access: (access ?? 'viewer') as Role,
    previewable: PREVIEWABLE.has(file.contentType),
    accessEnds,
  };
}

export async function serializeFolder(client: pg.PoolClient, person: Person, folderId: string): Promise<Folder> {
  const folder = await getFolder(client, folderId);
  if (!folder) throw new Error('folder missing');
  const owner = await client.query<{ name: string }>('SELECT name FROM people WHERE id = $1', [folder.ownerId]);
  const countRes = await client.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM files WHERE folder_id = $1 AND in_bin = false AND purged = false',
    [folderId],
  );
  const isPartner = person.kind === 'partner';
  let role: Role = 'viewer';
  if (!isPartner) {
    role = 'editor';
  } else {
    const grants = await activeGrantTop(client, person.id);
    const access = await effectiveFolderAccess(client, person, folderId, grants);
    role = access ?? 'viewer';
  }
  const hidden = isPartner && !(await partnerFolderVisible(client, person.id, folderId));
  const parentHidden = isPartner && folder.parentId !== null && !(await partnerFolderVisible(client, person.id, folder.parentId));
  return {
    id: hidden ? null : folder.id,
    name: hidden ? 'another folder' : folder.name,
    parentId: hidden || parentHidden ? null : folder.parentId,
    projectId: isPartner ? null : folder.projectId,
    owner: { id: hidden ? '' : folder.ownerId, name: owner.rows[0]?.name ?? '' },
    fileCount: Number(countRes.rows[0]?.count ?? 0),
    access: role,
  };
}

async function partnerFolderVisible(client: pg.PoolClient, personId: string, folderId: string): Promise<boolean> {
  const today = todayPhoenix(now());
  const res = await client.query<{ itemId: string }>(
    `SELECT item_id AS "itemId" FROM grants
     WHERE person_id = $1 AND item_type = 'folder' AND status = 'active' AND end_date >= $2`,
    [personId, today],
  );
  for (const g of res.rows) {
    const check = await client.query(
      `WITH RECURSIVE down AS (
         SELECT id FROM folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM folders f JOIN down ON f.parent_id = down.id
       ) SELECT 1 FROM down WHERE id = $2`,
      [g.itemId, folderId],
    );
    if ((check.rowCount ?? 0) > 0) return true;
  }
  return false;
}

export async function visibleFolders(client: pg.PoolClient, person: Person): Promise<string[]> {
  const res = await client.query<{ id: string }>('SELECT id FROM folders ORDER BY created_at ASC, id ASC');
  if (person.kind === 'staff') return res.rows.map(r => r.id);
  const today = todayPhoenix(now());
  const grants = await client.query<{ itemType: string; itemId: string }>(
    `SELECT item_type AS "itemType", item_id AS "itemId" FROM grants
     WHERE person_id = $1 AND status = 'active' AND end_date >= $2`,
    [person.id, today],
  );
  const visible = new Set<string>();
  for (const g of grants.rows) {
    if (g.itemType === 'folder') {
      const descendants = await client.query<{ id: string }>(
        `WITH RECURSIVE down AS (
           SELECT id FROM folders WHERE id = $1
           UNION ALL
           SELECT f.id FROM folders f JOIN down ON f.parent_id = down.id
         ) SELECT id FROM down`,
        [g.itemId],
      );
      for (const row of descendants.rows) visible.add(row.id);
    } else {
      const file = await client.query<{ folderId: string | null }>('SELECT folder_id AS "folderId" FROM files WHERE id = $1', [g.itemId]);
      if (file.rows[0]?.folderId) visible.add(file.rows[0].folderId);
    }
  }
  return res.rows.map(r => r.id).filter(id => visible.has(id));
}
