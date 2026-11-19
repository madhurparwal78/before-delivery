import { ApiError, sendJson } from '../http/respond.js';
import { pool, withTransaction } from '../db/pool.js';
import { now, toInstant, todayPhoenix, addDays, daysBetween } from '../domain/time.js';
import { recordLedger } from './ledger.js';
import { broadcast } from './events.js';
import { getFile, getFolder } from './access.js';
import { serializeFile } from './serialize.js';
import type { RouteContext } from './routes.js';
import * as storage from '../svc/storage.js';

export async function listBin(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const today = todayPhoenix(now());
  const res = await pool.query(
    `SELECT f.id, f.name, f.folder_id AS "folderId", f.size, f.content_type AS "contentType", f.modified_at AS "modifiedAt",
            f.locked, f.in_bin AS "inBin", f.last_activity AS "lastActivity",
            b.from_folder, b.binned_date::text AS binned_date, b.retention_days, f.bin_purge_pending
     FROM files f JOIN bin b ON b.file_id = f.id
     WHERE f.purged = false
     ORDER BY (b.binned_date + b.retention_days) ASC, f.name ASC`,
  );
  const items = [];
  const client = await pool.connect();
  try {
    for (const row of res.rows) {
      const purgeDate = addDays(row['binned_date'], row['retention_days']);
      const daysLeft = daysBetween(today, purgeDate);
      const fromFolderId = row['from_folder'];
      const folder = fromFolderId ? await getFolder(client, fromFolderId) : null;
      items.push({
        file: await serializeFile(client, person, row),
        fromFolder: { id: fromFolderId, name: folder?.name ?? '' },
        binnedDate: row['binned_date'],
        retentionDays: row['retention_days'],
        purgeDate,
        daysLeft,
        purgePending: row['bin_purge_pending'] === true,
      });
    }
  } finally {
    client.release();
  }
  sendJson(ctx.res, 200, { items });
}

export async function binFiles(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const body = ctx.body ?? {};
  const fileIds = body['fileIds'];
  if (!Array.isArray(fileIds) || fileIds.length < 1 || fileIds.length > 500 || !fileIds.every(f => typeof f === 'string')) {
    throw new ApiError('validation', { fileIds: 'Choose between 1 and 500 files.' });
  }
  const today = todayPhoenix(now());
  const retention = await policyValue('bin_retention_days', today);
  const result = await withTransaction(async (client) => {
    const binned: string[] = [];
    const stayed: Array<{ fileId: string; reason: 'locked' }> = [];
    for (const fileId of fileIds as string[]) {
      const file = await getFile(client, fileId);
      if (!file || file.inBin) throw new ApiError('not_found');
      if (file.locked) { stayed.push({ fileId, reason: 'locked' }); continue; }
      await client.query(
        'INSERT INTO bin (file_id, from_folder, binned_date, retention_days) VALUES ($1,$2,$3,$4) ON CONFLICT (file_id) DO NOTHING',
        [fileId, file.folderId, today, retention],
      );
      await client.query(
        'UPDATE files SET in_bin = true, binned_date = $2, bin_retention_days = $3, bin_from_folder = $4, last_activity = $5 WHERE id = $1',
        [fileId, today, retention, file.folderId, toInstant(now())],
      );
      await recordLedger(client, { id: person.id, name: person.name }, 'binned', fileId, file.folderId, { fileName: file.name });
      binned.push(fileId);
    }
    const folderIds = new Set<string>();
    for (const fileId of binned) {
      const file = await getFile(client, fileId);
      if (file?.folderId) folderIds.add(file.folderId);
    }
    const folderCounts: Record<string, number> = {};
    for (const fid of folderIds) {
      const countRes = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM files WHERE folder_id = $1 AND in_bin = false AND purged = false',
        [fid],
      );
      folderCounts[fid] = Number(countRes.rows[0]?.count ?? 0);
    }
    return { binned, stayed, folderCounts };
  });
  broadcast({ type: 'files_binned', data: { ...result, actorId: person.id } });
  sendJson(ctx.res, 200, result);
}

async function policyValue(kind: 'bin_retention_days' | 'partner_grant_days', date: string): Promise<number> {
  const res = await pool.query<{ days: string }>(
    'SELECT days::text AS days FROM policies WHERE kind = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1',
    [kind, date],
  );
  return Number(res.rows[0]?.days ?? 30);
}

export async function restoreFile(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const fileId = ctx.params['fileId']!;
  const result = await withTransaction(async (client) => {
    const file = await getFile(client, fileId);
    if (!file || !file.inBin) throw new ApiError('not_found');
    if (person.kind === 'partner') throw new ApiError('not_found');
    const binRow = await client.query<{ from_folder: string }>('SELECT from_folder FROM bin WHERE file_id = $1', [fileId]);
    const fromFolder = binRow.rows[0]?.from_folder ?? null;
    await client.query('DELETE FROM bin WHERE file_id = $1', [fileId]);
    await client.query(
      'UPDATE files SET in_bin = false, binned_date = NULL, bin_retention_days = NULL, bin_from_folder = NULL, folder_id = $2, last_activity = $3 WHERE id = $1',
      [fileId, fromFolder, toInstant(now())],
    );
    await recordLedger(client, { id: person.id, name: person.name }, 'restored', fileId, fromFolder, { fileName: file.name, toFolder: fromFolder });
    return { fileId, folderId: fromFolder };
  });
  broadcast({ type: 'file_restored', data: { fileId, folderId: result.folderId } });
  const client = await pool.connect();
  try {
    const file = await getFile(client, fileId);
    sendJson(ctx.res, 200, { file: await serializeFile(client, person, file!) });
  } finally {
    client.release();
  }
}

export async function deleteForever(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.staffRole !== 'controller') throw new ApiError('forbidden');
  const fileId = ctx.params['fileId']!;
  const binCheck = await pool.query('SELECT 1 FROM bin WHERE file_id = $1', [fileId]);
  if ((binCheck.rowCount ?? 0) === 0) throw new ApiError('not_found');
  const row = await pool.query<{ id: string; name: string; folder_id: string | null }>(
    'SELECT id, name, folder_id FROM files WHERE id = $1 AND purged = false', [fileId],
  );
  const file = row.rows[0];
  if (!file) throw new ApiError('not_found');
  try {
    await storage.deleteObject(fileId);
  } catch {
    throw new ApiError('storage_unavailable');
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM bin WHERE file_id = $1', [fileId]);
    await client.query('UPDATE files SET purged = true, folder_id = NULL WHERE id = $1', [fileId]);
    await client.query(`UPDATE grants SET status = 'ended', ended_reason = 'purged', ended_at = $2 WHERE item_type = 'file' AND item_id = $1 AND status = 'active'`, [fileId, toInstant(now())]);
    await recordLedger(client, { id: person.id, name: person.name }, 'purged', fileId, null, { fileName: file.name });
  });
  broadcast({ type: 'file_purged', data: { fileId, folderId: null, name: file.name, actorId: person.id } });
  ctx.res.writeHead(204);
  ctx.res.end();
}
