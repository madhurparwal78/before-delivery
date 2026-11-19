import { ApiError, sendJson } from '../http/respond.js';
import { pool, withTransaction } from '../db/pool.js';
import { now, toInstant, todayPhoenix, addDays, phoenixMidnightAfter } from '../domain/time.js';
import { newId } from '../domain/id.js';
import { recordLedger } from './ledger.js';
import { broadcast, pushNoticeToPerson } from './events.js';
import { getFile, getFolder, effectiveFileAccess, effectiveFolderAccess, activeGrantTop } from './access.js';
import { serializeFile, type FileDbRow } from './serialize.js';
import type { RouteContext } from './routes.js';
import * as storage from '../svc/storage.js';
import { config, uploadPauseTtlSeconds } from '../config/runtime.js';
import { visibleFolders } from './serialize.js';

const PART_SIZE = 5_242_880;
const MAX_SIZE = 2_000_000_000;

export async function uploadCreateWithBody(ctx: RouteContext, person: import('../domain/types.js').Person): Promise<{ status: number; body: Record<string, unknown> }> {
  const _unused = person;
  const body = ctx.body ?? {};
  const folderId = body['folderId'];
  const name = body['name'];
  const size = body['size'];
  const contentType = body['contentType'];
  if (typeof folderId !== 'string') throw new ApiError('validation', { folderId: 'Choose a folder.' });
  const nameError = typeof name === 'string' ? validateUploadName(name) : 'Enter a name.';
  if (nameError) throw new ApiError('validation', { name: nameError });
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
    throw new ApiError('validation', { size: 'Files can be up to 2,000,000,000 bytes.' });
  }
  if (typeof contentType !== 'string' || contentType.length < 1 || contentType.length > 100) {
    throw new ApiError('validation', { contentType: 'Enter a content type.' });
  }
  const client = await pool.connect();
  try {
    const folder = await getFolder(client, folderId);
    if (!folder) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const role = await effectiveFolderAccess(client, person, folderId, grants);
    if (!role || role !== 'editor') throw new ApiError(person.kind === 'partner' ? 'not_found' : 'forbidden');
  } finally {
    client.release();
  }
  const fileId = newId('fil');
  let s3UploadId: string;
  try {
    s3UploadId = await storage.createMultipart(fileId, contentType);
  } catch {
    throw new ApiError('storage_unavailable');
  }
  const partCount = Math.ceil(size / PART_SIZE);
  const created = await pool.query(
    `INSERT INTO uploads (id, folder_id, person_id, name, size, content_type, state, part_count, confirmed_parts, created_at, last_progress_at, idempotency_key, s3_upload_id)
     VALUES ($1,$2,$3,$4,$5,$6,'started',$7,$8,$9,$9,$10,$11)`,
    [fileId, folderId, person.id, (name as string).trim(), size, contentType, partCount, [], toInstant(now()), typeof ctx.req.headers['idempotency-key'] === 'string' ? ctx.req.headers['idempotency-key'] : null, s3UploadId],
  );
  broadcast({ type: 'upload_started', data: { uploadId: fileId, folderId, personId: person.id } });
  return { status: 201, body: { upload: uploadJson(fileId, folderId, (name as string).trim(), size, contentType, 'started', PART_SIZE, partCount, [], null) } };
}

function validateUploadName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Enter a name.';
  if (trimmed.length > 120) return 'Names can be up to 120 characters.';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Names cannot contain / or \\.';
  return null;
}

export function uploadJson(id: string, folderId: string, name: string, size: number, contentType: string, state: string, partSize: number, partCount: number, confirmedParts: number[], expiresAt: string | null): Record<string, unknown> {
  const expiresMs = state === 'started' || state === 'uploading' || state === 'paused'
    ? now() + uploadPauseTtlSeconds * 1000 : null;
  return {
    id, folderId, name, size, contentType, state, partSize, partCount, confirmedParts,
    expiresAt: expiresAt ? new Date(expiresMs!).toISOString().replace(/\.\d{3}Z$/, '.000Z') : null,
  };
}

export async function listUploads(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const res = await pool.query(
    `SELECT id, folder_id, name, size, content_type, state, part_count, confirmed_parts, created_at, last_progress_at
     FROM uploads WHERE person_id = $1 AND state IN ('started','uploading','paused','abandoned')
     ORDER BY created_at ASC`,
    [person.id],
  );
  const uploads = res.rows.map(r => uploadJson(
    r['id'], r['folder_id'], r['name'], Number(r['size']), r['content_type'], r['state'],
    PART_SIZE, r['part_count'], r['confirmed_parts'] ?? [], null,
  ));
  sendJson(ctx.res, 200, { uploads });
}

export async function getUpload(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query(
    `SELECT id, folder_id, name, size, content_type, state, part_count, confirmed_parts FROM uploads WHERE id = $1 AND person_id = $2`,
    [id, person.id],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  sendJson(ctx.res, 200, { upload: uploadJson(row['id'], row['folder_id'], row['name'], Number(row['size']), row['content_type'], row['state'], PART_SIZE, row['part_count'], row['confirmed_parts'] ?? [], null) });
}

export async function uploadPart(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const n = Number(ctx.params['n']);
  const raw = ctx.rawBody as Buffer;
  const res = await pool.query<{ state: string; part_count: number; confirmed_parts: number[]; folder_id: string; s3_upload_id: string | null; name: string; size: number; content_type: string }>(
    'SELECT state, part_count, confirmed_parts, folder_id, s3_upload_id, name, size, content_type FROM uploads WHERE id = $1 AND person_id = $2',
    [id, person.id],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  if (row['state'] === 'paused' || row['state'] === 'confirmed' || row['state'] === 'cancelled' || row['state'] === 'abandoned') {
    throw new ApiError(`upload_${row['state']}` as 'upload_paused');
  }
  if (!Number.isInteger(n) || n < 1 || n > row['part_count']) throw new ApiError('validation', { part: 'Enter a valid part.' });
  const expected = n === row['part_count'] ? row['size'] - (n - 1) * PART_SIZE : PART_SIZE;
  if (raw.length !== expected) throw new ApiError('validation', { part: 'Enter a valid part.' });
  try {
    await storage.uploadPart(id, row['s3_upload_id'] ?? '', n, raw);
  } catch {
    throw new ApiError('storage_unavailable');
  }
  await pool.query(
    `UPDATE uploads SET confirmed_parts = (SELECT array_append(array_remove(confirmed_parts, $2), $2) FROM uploads WHERE id = $1), state = 'uploading', last_progress_at = $3 WHERE id = $1`,
    [id, n, toInstant(now())],
  );
  const after = await pool.query('SELECT confirmed_parts FROM uploads WHERE id = $1', [id]);
  sendJson(ctx.res, 200, { upload: uploadJson(id, row['folder_id'], row['name'], Number(row['size']), row['content_type'], 'uploading', PART_SIZE, row['part_count'], after.rows[0]['confirmed_parts'] ?? [], null) });
}

export async function pauseUpload(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query(`SELECT state, folder_id, name, size, content_type, part_count, confirmed_parts, s3_upload_id FROM uploads WHERE id = $1 AND person_id = $2`, [id, person.id]);
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  if (row['state'] === 'paused') {
    sendJson(ctx.res, 200, { upload: uploadJson(id, row['folder_id'], row['name'], Number(row['size']), row['content_type'], 'paused', PART_SIZE, row['part_count'], row['confirmed_parts'] ?? [], null) });
    return;
  }
  if (row['state'] !== 'started' && row['state'] !== 'uploading') throw new ApiError(`upload_${row['state']}` as 'upload_paused');
  await pool.query(`UPDATE uploads SET state = 'paused', last_progress_at = $2 WHERE id = $1`, [id, toInstant(now())]);
  sendJson(ctx.res, 200, { upload: uploadJson(id, row['folder_id'], row['name'], Number(row['size']), row['content_type'], 'paused', PART_SIZE, row['part_count'], row['confirmed_parts'] ?? [], null) });
}

export async function resumeUpload(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query(`SELECT state, folder_id, name, size, content_type, part_count, confirmed_parts FROM uploads WHERE id = $1 AND person_id = $2`, [id, person.id]);
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  if (row['state'] === 'uploading' || row['state'] === 'started') {
    sendJson(ctx.res, 200, { upload: uploadJson(id, row['folder_id'], row['name'], Number(row['size']), row['content_type'], row['state'], PART_SIZE, row['part_count'], row['confirmed_parts'] ?? [], null) });
    return;
  }
  if (row['state'] !== 'paused') throw new ApiError(`upload_${row['state']}` as 'upload_paused');
  await pool.query(`UPDATE uploads SET state = 'uploading', last_progress_at = $2 WHERE id = $1`, [id, toInstant(now())]);
  sendJson(ctx.res, 200, { upload: uploadJson(id, row['folder_id'], row['name'], Number(row['size']), row['content_type'], 'uploading', PART_SIZE, row['part_count'], row['confirmed_parts'] ?? [], null) });
}

export async function completeUpload(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query(`SELECT state, folder_id, name, size, content_type, part_count, confirmed_parts, s3_upload_id FROM uploads WHERE id = $1 AND person_id = $2`, [id, person.id]);
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  if (row['state'] === 'confirmed') {
    const file = await loadFileRow(id);
    if (!file) throw new ApiError('not_found');
    const client = await pool.connect();
    try {
      sendJson(ctx.res, 200, { file: await serializeFile(client, person, file) });
    } finally {
      client.release();
    }
    return;
  }
  if (row['state'] !== 'uploading' && row['state'] !== 'started') throw new ApiError(`upload_${row['state']}` as 'upload_paused');
  const confirmed = (row['confirmed_parts'] ?? []) as number[];
  const missing: number[] = [];
  for (let i = 1; i <= row['part_count']; i++) {
    if (!confirmed.includes(i)) missing.push(i);
  }
  if (missing.length > 0 || row['state'] === 'started') {
    throw new ApiError('parts_missing', undefined, { missing });
  }
  let storedSize: number;
  try {
    storedSize = await storage.completeMultipart(id, row['s3_upload_id'] ?? '');
  } catch {
    throw new ApiError('storage_unavailable');
  }
  const fileRow = await withTransaction(async (client) => {
    await client.query(
      `UPDATE uploads SET state = 'confirmed', last_progress_at = $2 WHERE id = $1`,
      [id, toInstant(now())],
    );
    const createdAt = toInstant(now());
    await client.query(
      `INSERT INTO files (id, name, folder_id, size, content_type, modified_at, locked, created_at, purged, in_bin, last_activity)
       VALUES ($1,$2,$3,$4,$5,$6,false,$6,false,false,$6)`,
      [id, row['name'], row['folder_id'], storedSize, row['content_type'], createdAt],
    );
    await recordLedger(client, { id: person.id, name: person.name }, 'uploaded', id, row['folder_id'], { fileName: row['name'] });
    return { id, folderId: row['folder_id'] };
  });
  broadcast({ type: 'upload_confirmed', data: { uploadId: id, fileId: id, folderId: fileRow.folderId, name: row['name'], size: storedSize, personId: person.id } });
  const file = await loadFileRow(id);
  if (!file) throw new ApiError('not_found');
  const client = await pool.connect();
  try {
    sendJson(ctx.res, 201, { file: await serializeFile(client, person, file) });
  } finally {
    client.release();
  }
}

async function loadFileRow(id: string): Promise<FileDbRow | null> {
  const client = await pool.connect();
  try {
    return await getFile(client, id);
  } finally {
    client.release();
  }
}

export async function deleteUpload(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query(`SELECT state, s3_upload_id FROM uploads WHERE id = $1 AND person_id = $2`, [id, person.id]);
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  if (row['state'] === 'confirmed') throw new ApiError('upload_confirmed');
  if (row['state'] === 'cancelled' || row['state'] === 'abandoned') {
    await pool.query('DELETE FROM uploads WHERE id = $1', [id]);
    sendJson(ctx.res, 204, undefined as never);
    ctx.res.writeHead(204);
    ctx.res.end();
    return;
  }
  await pool.query(`UPDATE uploads SET state = 'cancelled' WHERE id = $1`, [id]);
  try {
    await storage.abortMultipart(id, row['s3_upload_id'] ?? '');
  } catch {
    /* retried later by sweep for abandoned; cancel removes parts on best effort now and sweep cleans */
  }
  broadcast({ type: 'upload_cancelled', data: { uploadId: id, personId: person.id } });
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function storageStats(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const used = await pool.query<{ total: string; bin: string }>(
    `SELECT COALESCE(SUM(size),0)::text AS total, COALESCE(SUM(CASE WHEN in_bin THEN size ELSE 0 END),0)::text AS bin FROM files WHERE purged = false`,
  );
  sendJson(ctx.res, 200, {
    usedBytes: Number(used.rows[0]?.total ?? 0),
    binBytes: Number(used.rows[0]?.bin ?? 0),
    quotaBytes: config.storageQuotaBytes,
  });
}
