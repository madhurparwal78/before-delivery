import { ApiError } from '../../domain/api-error.js';
import { UPLOAD_REFUSAL } from '../../domain/errors.js';
import { judgeFile, sourceFrames, waveformPeaks, type MediaHeader, type WavHeader } from '../../domain/media-header.js';
import { codePoints, fileNameIsValid, folderIsValid, invalid, isSha256 } from '../../domain/validate.js';
import { giveBackBytes, takeBytes } from '../allowance.js';
import { broadcastAllowance } from '../live.js';
import { allowance } from '../allowance.js';
import { UPLOAD_CHUNK_BYTES } from '../config.js';
import { query, transaction } from '../db.js';
import { jsonBody, notFound, requireOwner, sendEmpty, sendJson, type RequestContext, type Route } from '../http.js';
import { randomId, sha256Hex } from '../ids.js';
import { loadMediaRows, mediaRecord, usedIn, type MediaRow } from '../repo/media.js';
import { CacheKeys, valkey } from '../services/cache.js';
import { deleteObject, getObject, probeStorage, putObject, StorageDown, StorageKeys } from '../services/storage.js';
import { requireSigned } from '../http.js';
import { exactRate, isFrameRateName } from '../../domain/rate.js';

function storageUnavailable(): ApiError {
  return ApiError.of('storage_unavailable', undefined);
}

async function withStorage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
}

interface UploadRow {
  id: string;
  person_id: string;
  file_name: string;
  folder: string;
  bytes: number;
  sha256: string;
  chunks: number;
  state: 'open' | 'receiving' | 'confirmed' | 'refused';
  replaces: string | null;
}

async function chunksReceived(uploadId: string): Promise<number[]> {
  const rows = await query<{ n: number }>(`select n from upload_chunks where upload_id = $1 order by n`, [uploadId]);
  return rows.map((row) => row.n);
}

function chunkLength(upload: UploadRow, n: number): number {
  const full = Math.floor(upload.bytes / UPLOAD_CHUNK_BYTES);
  return n < full ? UPLOAD_CHUNK_BYTES : upload.bytes - full * UPLOAD_CHUNK_BYTES;
}

async function mediaById(id: string): Promise<MediaRow | null> {
  const rows = await query<MediaRow>(
    `select id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, header from media where id = $1`,
    [id],
  );
  return rows.length > 0 ? rows[0] : null;
}

async function mediaByChecksum(sha256: string): Promise<MediaRow | null> {
  const rows = await query<MediaRow>(
    `select id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, header
     from media where sha256 = $1`,
    [sha256],
  );
  return rows.length > 0 ? rows[0] : null;
}

async function duplicateResponse(context: RequestContext, status: number, row: MediaRow): Promise<void> {
  const used = await usedIn();
  sendJson(context.response, status, { duplicate: true, media: mediaRecord(row, used.get(row.id) ?? []) });
}

const TERM_LIMIT = 8;
const QUERY_LIMIT = 200;

function matchesSearch(row: MediaRow, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const words = `${row.name} ${row.folder}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

function encodeCursor(row: MediaRow): string {
  return Buffer.from(JSON.stringify([row.folder, row.name]), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw new Error('bad cursor');
    }
    return [parsed[0], parsed[1]];
  } catch {
    throw invalid('cursor');
  }
}

export const mediaRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/uploads',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const signed = requireOwner(context);
      const body = jsonBody(context);
      const errors: Record<string, string> = {};
      const fileName = typeof body.file_name === 'string' ? body.file_name : '';
      const folder = typeof body.folder === 'string' ? body.folder : '';
      const bytes = body.bytes;
      if (!fileNameIsValid(fileName)) errors.file_name = 'File names are 1 to 120 characters with no slashes, control characters or leading dot.';
      if (!folderIsValid(folder)) errors.folder = 'That value is not allowed here.';
      if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > 8000000000) {
        errors.bytes = 'That value is not allowed here.';
      }
      if (!isSha256(body.sha256)) errors.sha256 = 'That value is not allowed here.';
      if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
      const sha256 = body.sha256 as string;
      const size = bytes as number;
      const replaces = typeof body.replaces === 'string' ? body.replaces : null;
      if (replaces !== null && (await mediaById(replaces)) === null) throw invalid('replaces');

      const stored = await mediaByChecksum(sha256);
      if (stored !== null) {
        await duplicateResponse(context, 200, stored);
        return;
      }
      const open = await query<UploadRow>(
        `select id, person_id, file_name, folder, bytes, sha256, chunks, state, replaces from uploads
         where person_id = $1 and sha256 = $2 and state in ('open','receiving') order by created_at limit 1`,
        [signed.person.id, sha256],
      );
      if (open.length > 0) {
        const upload = open[0];
        if (Number(upload.bytes) !== size) throw invalid('bytes');
        sendJson(context.response, 200, {
          upload_id: upload.id,
          chunk_bytes: UPLOAD_CHUNK_BYTES,
          chunks: upload.chunks,
          chunks_received: await chunksReceived(upload.id),
        });
        return;
      }
      const current = await allowance();
      if (current.storage_bytes_used + size > current.storage_bytes_allowance) {
        throw ApiError.of(
          'allowance_exceeded',
          {
            export_minutes_used: current.export_minutes_used,
            export_minutes_allowance: current.export_minutes_allowance,
            storage_bytes_used: current.storage_bytes_used,
            storage_bytes_allowance: current.storage_bytes_allowance,
          },
          { allowance: current },
        );
      }
      if (!(await probeStorage())) throw storageUnavailable();
      const id = randomId('up');
      const chunks = Math.max(1, Math.ceil(size / UPLOAD_CHUNK_BYTES));
      await query(
        `insert into uploads (id, person_id, file_name, folder, bytes, sha256, chunks, state, replaces)
         values ($1,$2,$3,$4,$5,$6,$7,'open',$8)`,
        [id, signed.person.id, fileName, folder, size, sha256, chunks, replaces],
      );
      sendJson(context.response, 201, {
        upload_id: id,
        chunk_bytes: UPLOAD_CHUNK_BYTES,
        chunks,
        chunks_received: [],
      });
    },
  },
  {
    method: 'GET',
    path: '/api/uploads',
    auth: 'session',
    handle: async (context) => {
      const signed = requireOwner(context);
      const rows = await query<UploadRow>(
        `select id, person_id, file_name, folder, bytes, sha256, chunks, state, replaces from uploads
         where person_id = $1 and state in ('open','receiving') order by created_at`,
        [signed.person.id],
      );
      const items = [];
      for (const upload of rows) {
        items.push({
          upload_id: upload.id,
          file_name: upload.file_name,
          folder: upload.folder,
          bytes: Number(upload.bytes),
          sha256: upload.sha256,
          chunks: upload.chunks,
          chunks_received: await chunksReceived(upload.id),
          state: upload.state,
        });
      }
      sendJson(context.response, 200, { items });
    },
  },
  {
    method: 'PUT',
    path: '/api/uploads/{id}/chunks/{n}',
    auth: 'session',
    body: 'octet',
    handle: async (context) => {
      const signed = requireOwner(context);
      const rows = await query<UploadRow>(
        `select id, person_id, file_name, folder, bytes, sha256, chunks, state, replaces from uploads
         where id = $1 and person_id = $2`,
        [context.params.id, signed.person.id],
      );
      if (rows.length === 0) throw notFound();
      const upload = rows[0];
      const n = Number(context.params.n);
      if (!Number.isInteger(n) || n < 0 || n >= upload.chunks) throw invalid('chunk');
      const already = await chunksReceived(upload.id);
      if (already.includes(n)) {
        sendEmpty(context.response, 204);
        return;
      }
      if (context.body.length !== chunkLength(upload, n)) throw invalid('chunk');
      await withStorage(() => putObject(StorageKeys.chunk(upload.id, n), context.body));
      await query(`insert into upload_chunks (upload_id, n, bytes) values ($1,$2,$3) on conflict do nothing`, [
        upload.id,
        n,
        context.body.length,
      ]);
      await query(`update uploads set state = 'receiving' where id = $1 and state = 'open'`, [upload.id]);
      sendEmpty(context.response, 204);
    },
  },
  {
    method: 'GET',
    path: '/api/uploads/{id}',
    auth: 'session',
    handle: async (context) => {
      const signed = requireOwner(context);
      const rows = await query<UploadRow>(
        `select id, person_id, file_name, folder, bytes, sha256, chunks, state, replaces from uploads
         where id = $1 and person_id = $2`,
        [context.params.id, signed.person.id],
      );
      if (rows.length === 0) throw notFound();
      const upload = rows[0];
      const received = await chunksReceived(upload.id);
      const missing = [];
      for (let n = 0; n < upload.chunks; n += 1) if (!received.includes(n)) missing.push(n);
      sendJson(context.response, 200, {
        state: upload.state,
        chunks_received: received,
        next_chunk: missing.length > 0 ? missing[0] : null,
      });
    },
  },
  {
    method: 'POST',
    path: '/api/uploads/{id}/complete',
    auth: 'session',
    handle: async (context) => {
      const signed = requireOwner(context);
      const rows = await query<UploadRow>(
        `select id, person_id, file_name, folder, bytes, sha256, chunks, state, replaces from uploads
         where id = $1 and person_id = $2`,
        [context.params.id, signed.person.id],
      );
      if (rows.length === 0) throw notFound();
      const upload = rows[0];
      const received = await chunksReceived(upload.id);
      const missing: number[] = [];
      for (let n = 0; n < upload.chunks; n += 1) if (!received.includes(n)) missing.push(n);
      if (missing.length > 0) throw ApiError.of('upload_incomplete', { missing }, { missing });

      const parts = await withStorage(async () => {
        const chunks: Buffer[] = [];
        for (let n = 0; n < upload.chunks; n += 1) {
          const part = await getObject(StorageKeys.chunk(upload.id, n));
          if (part === null) throw new StorageDown();
          chunks.push(part);
        }
        return chunks;
      });
      const body = Buffer.concat(parts);
      const refuse = async (reason: string): Promise<never> => {
        await query(`update uploads set state = 'refused' where id = $1`, [upload.id]);
        await dropChunks(upload.id, upload.chunks);
        throw ApiError.of('upload_refused', { file_name: upload.file_name, reason }, { reason });
      };
      if (sha256Hex(body) !== upload.sha256) await refuse(UPLOAD_REFUSAL.checksumMismatch);
      const judged = judgeFile(body);
      if (!judged.ok) await refuse(judged.reason);
      const header = judged.ok ? judged.header : null;
      if (header === null) throw storageUnavailable();

      const stored = await mediaByChecksum(upload.sha256);
      if (stored !== null) {
        await query(`update uploads set state = 'confirmed' where id = $1`, [upload.id]);
        await dropChunks(upload.id, upload.chunks);
        await duplicateResponse(context, 200, stored);
        return;
      }

      const replacing = upload.replaces === null ? null : await mediaById(upload.replaces);
      if (replacing !== null && replacing.kind !== header.kind) await refuse(UPLOAD_REFUSAL.replacementKind);
      if (replacing !== null) {
        const shortfall = await replacementShortfall(replacing, header);
        if (shortfall !== null) await refuse(UPLOAD_REFUSAL.replacementShort(shortfall));
      }

      await takeBytes(Number(upload.bytes));
      try {
        await withStorage(() => putObject(StorageKeys.media(upload.sha256), body));
      } catch (error) {
        await giveBackBytes(Number(upload.bytes));
        throw error;
      }
      const width = header.kind === 'wav' ? null : header.width;
      const height = header.kind === 'wav' ? null : header.height;
      const duration =
        header.kind === 'mp4'
          ? (header.duration / header.timescale).toFixed(3)
          : header.kind === 'wav'
            ? (header.samples / header.sample_rate).toFixed(3)
            : null;
      const id = replacing === null ? randomId('media') : replacing.id;
      const name = replacing === null ? upload.file_name : replacing.name;
      const folder = replacing === null ? upload.folder : replacing.folder;
      const previousBytes = replacing === null ? 0 : Number(replacing.bytes);
      const previousChecksum = replacing === null ? null : replacing.sha256;
      await transaction(async (client) => {
        if (replacing === null) {
          await client.query(
            `insert into media (id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, header)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              id,
              name,
              header.kind,
              folder,
              upload.bytes,
              upload.sha256,
              width,
              height,
              duration,
              header.kind === 'wav' ? header.sample_rate : null,
              JSON.stringify(header),
            ],
          );
        } else {
          await client.query(
            `update media set bytes = $2, sha256 = $3, width = $4, height = $5, duration_seconds = $6,
               sample_rate = $7, header = $8 where id = $1`,
            [
              id,
              upload.bytes,
              upload.sha256,
              width,
              height,
              duration,
              header.kind === 'wav' ? header.sample_rate : null,
              JSON.stringify(header),
            ],
          );
        }
        await client.query(`update uploads set state = 'confirmed' where id = $1`, [upload.id]);
      });
      if (replacing !== null && previousChecksum !== null) {
        await valkey.del(CacheKeys.peaks(previousChecksum));
        await giveBackBytes(previousBytes);
        await withStorage(() => deleteObject(StorageKeys.media(previousChecksum)));
      }
      await dropChunks(upload.id, upload.chunks);
      broadcastAllowance(await allowance());
      const row = await mediaById(id);
      const used = await usedIn();
      sendJson(context.response, 201, {
        duplicate: false,
        media: row === null ? null : mediaRecord(row, used.get(id) ?? []),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/media',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      if (!signed.is_owner) {
        const editable = await query<{ count: number }>(
          `select count(*)::int as count from members where person_id = $1 and role = 'editor'`,
          [signed.person.id],
        );
        if ((editable[0]?.count ?? 0) === 0) throw ApiError.of('forbidden', undefined);
      }
      const q = context.url.searchParams.get('q') ?? '';
      if (codePoints(q) > QUERY_LIMIT) throw invalid('q');
      const terms = q.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
      if (terms.length > TERM_LIMIT) throw invalid('q');
      const limitText = context.url.searchParams.get('limit');
      const limit = limitText === null ? 100 : Number(limitText);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('limit');
      const folder = context.url.searchParams.get('folder');
      const cursor = context.url.searchParams.get('cursor');
      const after = cursor === null ? null : decodeCursor(cursor);
      const rows = await loadMediaRows();
      const used = await usedIn();
      const filtered = rows
        .filter((row) => (folder === null || row.folder === folder) && matchesSearch(row, terms))
        .filter((row) => {
          if (after === null) return true;
          return row.folder > after[0] || (row.folder === after[0] && row.name > after[1]);
        });
      const page = filtered.slice(0, limit);
      sendJson(context.response, 200, {
        items: page.map((row) => mediaRecord(row, used.get(row.id) ?? [])),
        next_cursor: filtered.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/media/{id}/peaks',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      if (!signed.is_owner) {
        const editable = await query<{ count: number }>(
          `select count(*)::int as count from members where person_id = $1 and role = 'editor'`,
          [signed.person.id],
        );
        if ((editable[0]?.count ?? 0) === 0) throw ApiError.of('forbidden', undefined);
      }
      const row = await mediaById(context.params.id);
      if (row === null || row.kind !== 'wav') throw notFound();
      const cached = await valkey.get(CacheKeys.peaks(row.sha256));
      if (cached !== null) {
        sendJson(context.response, 200, { peaks: JSON.parse(cached) as number[] });
        return;
      }
      const body = await withStorage(() => getObject(StorageKeys.media(row.sha256)));
      if (body === null) throw storageUnavailable();
      const judged = judgeFile(body);
      if (!judged.ok || judged.header.kind !== 'wav') throw notFound();
      const peaks = waveformPeaks(body, judged.header as WavHeader);
      await valkey.set(CacheKeys.peaks(row.sha256), JSON.stringify(peaks));
      sendJson(context.response, 200, { peaks });
    },
  },
  {
    method: 'DELETE',
    path: '/api/media/{id}',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const row = await mediaById(context.params.id);
      if (row === null) throw notFound();
      const used = await usedIn();
      const projects = used.get(row.id) ?? [];
      if (projects.length > 0) {
        throw ApiError.of('media_in_use', { file_name: row.name, projects }, { projects });
      }
      await withStorage(() => deleteObject(StorageKeys.media(row.sha256)));
      await valkey.del(CacheKeys.peaks(row.sha256));
      await query(`delete from media where id = $1`, [row.id]);
      await giveBackBytes(Number(row.bytes));
      broadcastAllowance(await allowance());
      sendEmpty(context.response, 204);
    },
  },
];

async function dropChunks(uploadId: string, chunks: number): Promise<void> {
  for (let n = 0; n < chunks; n += 1) {
    try {
      await deleteObject(StorageKeys.chunk(uploadId, n));
    } catch {
      /* chunk objects are swept again when storage returns */
    }
  }
  await query(`delete from upload_chunks where upload_id = $1`, [uploadId]);
}

/** A replacement must be long enough for every clip that uses the file. */
async function replacementShortfall(replacing: MediaRow, header: MediaHeader): Promise<string | null> {
  const rows = await query<{ title: string; source_out: number; frame_rate: string }>(
    `select p.title, c.source_out, p.frame_rate from clips c join projects p on p.id = c.project_id
     where c.media_id = $1`,
    [replacing.id],
  );
  for (const row of rows) {
    if (!isFrameRateName(row.frame_rate)) continue;
    if (row.source_out > sourceFrames(header, exactRate(row.frame_rate))) return row.title;
  }
  return null;
}
