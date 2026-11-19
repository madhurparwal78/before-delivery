import pg from 'pg';
import type { Person, Role } from '../domain/types.js';
import { todayPhoenix, now, addDays, daysBetween } from '../domain/time.js';

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string | null;
  ownerId: string;
}

export interface FileRecord {
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

export async function getFolder(client: pg.PoolClient, id: string): Promise<FolderRecord | null> {
  const res = await client.query<FolderRecord>(
    'SELECT id, name, parent_id AS "parentId", project_id AS "projectId", owner_id AS "ownerId" FROM folders WHERE id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function getFile(client: pg.PoolClient, id: string): Promise<FileRecord | null> {
  const res = await client.query<FileRecord>(
    `SELECT id, name, folder_id AS "folderId", size, content_type AS "contentType", modified_at AS "modifiedAt",
            locked, in_bin AS "inBin", last_activity AS "lastActivity"
     FROM files WHERE id = $1 AND purged = false`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function folderAncestors(client: pg.PoolClient, folderId: string): Promise<FolderRecord[]> {
  const res = await client.query<FolderRecord>(
    `WITH RECURSIVE up AS (
       SELECT id, name, parent_id, project_id, owner_id, 0 AS depth FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.name, f.parent_id, f.project_id, f.owner_id, up.depth + 1
       FROM folders f JOIN up ON f.id = up.parent_id
     )
     SELECT id, name, parent_id AS "parentId", project_id AS "projectId", owner_id AS "ownerId"
     FROM up ORDER BY depth DESC`,
    [folderId],
  );
  return res.rows;
}

export async function activeGrantTop(client: pg.PoolClient, personId: string): Promise<Map<string, Role>> {
  const today = todayPhoenix(now());
  const res = await client.query<{ itemType: string; itemId: string; role: Role }>(
    `SELECT item_type AS "itemType", item_id AS "itemId", role FROM grants
     WHERE person_id = $1 AND status = 'active' AND end_date >= $2`,
    [personId, today],
  );
  const map = new Map<string, Role>();
  for (const row of res.rows) {
    map.set(`${row.itemType}:${row.itemId}`, row.role);
  }
  return map;
}

export interface EffectiveAccess {
  role: Role | null;
  viaGrantId: string | null;
}

export async function effectiveFolderAccess(client: pg.PoolClient, person: Person, folderId: string, grantMap: Map<string, Role>): Promise<Role | null> {
  if (person.kind === 'staff') return 'editor';
  const ancestors = await folderAncestors(client, folderId);
  let best: Role | null = null;
  for (const f of ancestors) {
    const role = grantMap.get(`folder:${f.id}`);
    if (role === 'editor') return 'editor';
    if (role === 'viewer') best = 'viewer';
  }
  return best;
}

export async function effectiveFileAccess(client: pg.PoolClient, person: Person, file: FileRecord, grantMap: Map<string, Role>): Promise<Role | null> {
  if (person.kind === 'staff') return 'editor';
  const direct = grantMap.get(`file:${file.id}`);
  const folderRole = file.folderId ? await effectiveFolderAccess(client, person, file.folderId, grantMap) : null;
  if (direct === 'editor' || folderRole === 'editor') return 'editor';
  if (direct === 'viewer' || folderRole === 'viewer') return 'viewer';
  return null;
}

export async function visibleFoldersForPartner(client: pg.PoolClient, personId: string): Promise<Set<string>> {
  const today = todayPhoenix(now());
  const res = await client.query<{ itemType: string; itemId: string }>(
    `SELECT item_type AS "itemType", item_id AS "itemId" FROM grants WHERE person_id = $1 AND status = 'active' AND end_date >= $2`,
    [personId, today],
  );
  const visible = new Set<string>();
  const folderGrants = res.rows.filter(r => r.itemType === 'folder');
  const fileGrants = res.rows.filter(r => r.itemType === 'file');
  for (const g of folderGrants) {
    visible.add(g.itemId);
    const descendants = await client.query<{ id: string }>(
      `WITH RECURSIVE down AS (
         SELECT id FROM folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM folders f JOIN down ON f.parent_id = down.id
       ) SELECT id FROM down`,
      [g.itemId],
    );
    for (const row of descendants.rows) visible.add(row.id);
  }
  const fileFolderIds = fileGrants.length > 0
    ? (await client.query<{ folderId: string | null }>(
        `SELECT folder_id AS "folderId" FROM files WHERE id = ANY($1::text[])`,
        [fileGrants.map(g => g.itemId)],
      )).rows.map(r => r.folderId).filter((v): v is string => v !== null)
    : [];
  for (const fid of fileFolderIds) visible.add(fid);
  return visible;
}

export async function fileAccessEndDate(client: pg.PoolClient, person: Person, file: FileRecord): Promise<string | null> {
  if (person.kind === 'staff') return null;
  const today = todayPhoenix(now());
  const res = await client.query<{ itemType: string; itemId: string; role: Role; endDate: string }>(
    `SELECT item_type AS "itemType", item_id AS "itemId", role, end_date::text AS "endDate" FROM grants
     WHERE person_id = $1 AND status = 'active' AND end_date >= $2`,
    [person.id, today],
  );
  const role = await effectiveFileAccess(client, person, file, activeGrantMapFromRows(res.rows));
  if (!role) return null;
  const relevant: Array<{ itemType: string; itemId: string; role: Role; endDate: string }> = [];
  for (const g of res.rows) {
    if (g.role !== role) continue;
    if (g.itemId === file.id) { relevant.push(g); continue; }
    if (g.itemType === 'folder' && file.folderId !== null && (await folderAncestorsIncludes(client, g.itemId, file.folderId))) {
      relevant.push(g);
    }
  }
  let latest: string | null = null;
  for (const g of relevant) {
    if (latest === null || g.endDate > latest) latest = g.endDate;
  }
  return latest;
}

function activeGrantMapFromRows(rows: Array<{ itemType: string; itemId: string; role: Role }>): Map<string, Role> {
  const map = new Map<string, Role>();
  for (const row of rows) map.set(`${row.itemType}:${row.itemId}`, row.role);
  return map;
}

async function folderAncestorsIncludes(client: pg.PoolClient, ancestorId: string, folderId: string): Promise<boolean> {
  const res = await client.query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
     ) SELECT 1 FROM up WHERE id = $2`,
    [folderId, ancestorId],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

export function grantDaysLeft(endDate: string): number {
  return daysBetween(todayPhoenix(now()), endDate);
}
