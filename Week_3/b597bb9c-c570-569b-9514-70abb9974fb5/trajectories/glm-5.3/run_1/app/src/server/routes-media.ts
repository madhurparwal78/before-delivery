import { Router } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond, announceAllowance } from './routes-session';
import { memberRole } from './routes-projects';
import { judgeMedia, waveformPeaks } from './media-judge';
import { sha256Hex, newHex, codePoints } from './util';
import { CHUNK_BYTES } from '../shared/errors';
import type { Media } from '../shared/types';

/** Uploads, the media library, search, waveform peaks and deletion. */
export function mediaRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.post('/uploads', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const fileName = String(body.file_name ?? '');
      const folder = String(body.folder ?? '');
      const bytes = Number(body.bytes ?? 0);
      const sha = String(body.sha256 ?? '');
      const replaces = body.replaces === undefined ? null : String(body.replaces);

      const errors: Record<string, { key: 'file_name' | 'other'; params?: Record<string, string> }> = {};
      if (!validFileName(fileName)) errors.file_name = { key: 'file_name' };
      if (!validFolder(folder)) errors.folder = { key: 'other' };
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > 8_000_000_000) errors.bytes = { key: 'other' };
      if (!/^[0-9a-f]{64}$/.test(sha)) errors.sha256 = { key: 'other' };
      if (Object.keys(errors).length > 0) throw ApiError.validation(errors as never);

      // Storage outage holds the upload.
      if (!ctx.storage.isUp()) throw new ApiError('storage_unavailable');

      // One object per checksum: a stored checksum answers duplicate.
      const existing = await ctx.db.query(
        'SELECT * FROM media WHERE sha256 = $1',
        [sha],
      );
      if ((existing.rowCount ?? 0) > 0) {
        const m = existing.rows[0]!;
        res.json({ duplicate: true, media: await mediaJson(ctx, m) });
        return;
      }
      // A resumed upload: the same open upload, keeping the first create's
      // file name and folder.
      const open = await ctx.db.query(
        `SELECT * FROM uploads WHERE sha256 = $1 AND workspace_id = $2 AND state IN ('open','receiving') ORDER BY created_at LIMIT 1`,
        [sha, ctx.workspaceId],
      );
      if ((open.rowCount ?? 0) > 0) {
        const u = open.rows[0]!;
        if (Number(u.bytes) !== bytes) {
          throw ApiError.validation({ bytes: { key: 'other' } });
        }
        const received = await ctx.db.query('SELECT chunk_no FROM upload_chunks WHERE upload_id = $1 ORDER BY chunk_no', [u.id]);
        res.json({
          upload_id: u.id,
          chunk_bytes: CHUNK_BYTES,
          chunks: Math.ceil(Number(u.bytes) / CHUNK_BYTES),
          chunks_received: received.rows.map((row: { chunk_no: number }) => row.chunk_no),
        });
        return;
      }
      // The storage allowance is taken in one atomic step on create.
      const allowance = await ctx.counters.takeStorageBytes(bytes, ctx.config.storageAllowanceBytes);
      if (allowance === null) {
        const current = await ctx.counters.getStorageBytes();
        throw new ApiError('allowance_exceeded', {
          used: 0, allowance: ctx.config.exportMinuteAllowance,
          usedGB: gbText(current ?? 0), allowanceGB: gbText(ctx.config.storageAllowanceBytes),
        }, { allowance: {
          workspace_id: ctx.workspaceId, month: '', export_minutes_used: 0,
          export_minutes_allowance: ctx.config.exportMinuteAllowance,
          storage_bytes_used: current ?? 0, storage_bytes_allowance: ctx.config.storageAllowanceBytes,
          resets_at: '', text: '',
        } });
      }
      const id = `up-${newHex(8)}`;
      await ctx.db.query(
        `INSERT INTO uploads (id, workspace_id, file_name, folder, bytes, sha256, replaces, chunks, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
        [id, ctx.workspaceId, fileName, folder, bytes, sha, replaces, Math.ceil(bytes / CHUNK_BYTES)],
      );
      res.status(201).json({ upload_id: id, chunk_bytes: CHUNK_BYTES, chunks: Math.ceil(bytes / CHUNK_BYTES), chunks_received: [] });
      await announceAllowance(ctx);
    })().catch((err) => respond(res, err));
  });

  r.get('/uploads', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const rows = await ctx.db.query(
        `SELECT u.*, array_agg(c.chunk_no ORDER BY c.chunk_no) AS received
         FROM uploads u LEFT JOIN upload_chunks c ON c.upload_id = u.id
         WHERE u.workspace_id = $1 AND u.state IN ('open','receiving')
         GROUP BY u.id ORDER BY u.created_at`,
        [ctx.workspaceId],
      );
      res.json({
        items: rows.rows.map((u: Record<string, unknown>) => ({
          upload_id: u.id,
          file_name: u.file_name,
          folder: u.folder,
          bytes: Number(u.bytes),
          sha256: u.sha256,
          chunks: Number(u.chunks),
          chunks_received: (u.received as (number | null)[]).filter((n): n is number => n !== null),
          state: u.state,
        })),
      });
    })().catch((err) => respond(res, err));
  });

  r.put('/uploads/:id/chunks/:n', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      if (!ctx.storage.isUp()) throw new ApiError('storage_unavailable');
      const upload = await ctx.db.query('SELECT * FROM uploads WHERE id = $1', [req.params.id!]);
      if ((upload.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const u = upload.rows[0]!;
      const n = Number(req.params.n!);
      const chunkBytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
      const expected = Math.min(CHUNK_BYTES, Number(u.bytes) - n * CHUNK_BYTES);
      if (chunkBytes.length !== expected) {
        throw ApiError.validation({ chunk: { key: 'other' } });
      }
      const already = await ctx.db.query('SELECT 1 FROM upload_chunks WHERE upload_id = $1 AND chunk_no = $2', [u.id, n]);
      if ((already.rowCount ?? 0) > 0) {
        res.status(204).end();
        return;
      }
      await ctx.storage.put(`uploads/${u.id}/${n}`, chunkBytes);
      await ctx.db.query('INSERT INTO upload_chunks (upload_id, chunk_no, bytes) VALUES ($1,$2,$3)', [u.id, n, chunkBytes.length]);
      if (u.state === 'open') {
        await ctx.db.query("UPDATE uploads SET state = 'receiving' WHERE id = $1", [u.id]);
      }
      res.status(204).end();
    })().catch((err) => respond(res, err));
  });

  r.get('/uploads/:id', (req, res) => {
    void (async () => {
      requireAuth(req);
      const u = await ctx.db.query('SELECT * FROM uploads WHERE id = $1', [req.params.id!]);
      if ((u.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const received = await ctx.db.query('SELECT chunk_no FROM upload_chunks WHERE upload_id = $1 ORDER BY chunk_no', [req.params.id!]);
      const list = received.rows.map((row: { chunk_no: number }) => row.chunk_no);
      let next: number | null = null;
      for (let i = 0; i < Number(u.rows[0]!.chunks); i++) {
        if (!list.includes(i)) { next = i; break; }
      }
      res.json({ state: u.rows[0]!.state, chunks_received: list, next_chunk: next });
    })().catch((err) => respond(res, err));
  });

  r.post('/uploads/:id/complete', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const result = await completeUpload(ctx, req.params.id!);
      if (result.duplicate) {
        res.json({ duplicate: true, media: result.media });
        return;
      }
      res.status(201).json({ duplicate: false, media: result.media });
    })().catch((err) => respond(res, err));
  });

  r.get('/media/:id/peaks', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) {
        const editor = await ctx.db.query(
          `SELECT 1 FROM members WHERE person_id = $1 AND role = 'editor'`, [person.id]);
        if ((editor.rowCount ?? 0) === 0) throw new ApiError('forbidden');
      }
      const media = await ctx.db.query('SELECT * FROM media WHERE id = $1', [req.params.id!]);
      if ((media.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const m = media.rows[0]!;
      if (m.kind !== 'wav') throw new ApiError('not_found');
      const kept = await ctx.counters.getPeaks(m.sha256);
      if (kept !== null) {
        res.json({ peaks: kept });
        return;
      }
      const bytes = await ctx.storage.get(`media/${m.sha256}`);
      const peaks = waveformPeaks(bytes, {
        channels: m.channels, sampleRate: m.sample_rate, bits: m.bits,
        sampleFrames: m.sample_frames, blockAlign: (m.channels * m.bits) / 8,
      });
      await ctx.counters.setPeaks(m.sha256, peaks);
      res.json({ peaks });
    })().catch((err) => respond(res, err));
  });

  r.delete('/media/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const media = await ctx.db.query('SELECT * FROM media WHERE id = $1', [req.params.id!]);
      if ((media.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const m = media.rows[0]!;
      // Files in use stay: list every project that uses this checksum.
      const used = await ctx.db.query<{ title: string }>(
        `SELECT DISTINCT p.title FROM clips c JOIN projects p ON p.id = c.project_id
         JOIN media md ON md.id = c.media_id WHERE md.sha256 = $1 ORDER BY p.title`,
        [m.sha256],
      );
      if (used.rows.length > 0) {
        const titles = used.rows.map((row) => row.title);
        throw new ApiError('media_in_use', { file: m.name, projects: titles.join(', ') }, { projects: titles });
      }
      await ctx.db.query('DELETE FROM media WHERE id = $1', [m.id]);
      await ctx.storage.remove(`media/${m.sha256}`).catch(() => undefined);
      await ctx.counters.deletePeaks(m.sha256);
      await ctx.counters.giveBackStorageBytes(Number(m.bytes));
      await announceAllowance(ctx);
      res.status(204).end();
    })().catch((err) => respond(res, err));
  });

  return r;
}

function gbText(bytes: number): string {
  const exact = bytes / 1_000_000_000;
  const scaled = Math.ceil(exact * 10 - 1e-9) / 10;
  return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
}

function validFileName(name: string): boolean {
  if (codePoints(name) < 1 || codePoints(name) > 120) return false;
  if (name.startsWith('.')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c < 32 || c === 127) return false;
  }
  return true;
}

function validFolder(folder: string): boolean {
  if (codePoints(folder) < 1 || codePoints(folder) > 80) return false;
  const segments = folder.split('/').map((s) => s.trim());
  if (segments.some((s) => s === '.' || s === '..' || s === '')) return false;
  return true;
}

/** The library list with bounded search, owner and editor. */
export function mediaListRoute(ctx: AppCtx): Router {
  const r = Router();
  r.get('/media', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) {
        const editor = await ctx.db.query(`SELECT 1 FROM members WHERE person_id = $1 AND role = 'editor'`, [person.id]);
        if ((editor.rowCount ?? 0) === 0) throw new ApiError('forbidden');
      }
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const folder = typeof req.query.folder === 'string' ? req.query.folder : '';
      if (codePoints(q) > 200) {
        throw ApiError.validation({ q: { key: 'q' } });
      }
      const terms = q.split(/\s+/).filter((t) => t !== '');
      if (terms.length > 8) {
        throw ApiError.validation({ q: { key: 'q' } });
      }
      const rows = await ctx.db.query(
        `SELECT m.* FROM media m WHERE m.workspace_id = $1 ORDER BY m.folder, m.name`,
        [ctx.workspaceId],
      );
      let items = await Promise.all(rows.rows.map((m: Record<string, unknown>) => mediaJson(ctx, m)));
      if (terms.length > 0) {
        items = items.filter((m) => matchesSearch(m, terms, folder));
      } else if (folder !== '') {
        items = items.filter((m) => m.folder === folder);
      }
      res.json({ items, next_cursor: null });
    })().catch((err) => respond(res, err));
  });
  return r;
}

function matchesSearch(m: Media, terms: string[], folderFilter: string): boolean {
  if (folderFilter !== '' && m.folder !== folderFilter) return false;
  const words = [...m.name.split(/[^\p{L}\p{N}]+/u), ...m.folder.split(/[^\p{L}\p{N}]+/u)].filter((w) => w !== '');
  const lower = words.map((w) => w.toLowerCase());
  return terms.every((t) => lower.some((w) => w.startsWith(t.toLowerCase())));
}

export async function mediaJson(ctx: AppCtx, m: Record<string, unknown>): Promise<Media> {
  const used = await ctx.db.query<{ title: string }>(
    `SELECT DISTINCT p.title FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.media_id = $1 ORDER BY p.title`,
    [m.id],
  );
  const durationTimescale = Number(m.duration_timescale ?? 0);
  const duration = durationTimescale > 0
    ? Number(m.duration) / durationTimescale
    : m.sample_rate && m.sample_frames
      ? Number(m.sample_frames) / Number(m.sample_rate)
      : null;
  return {
    id: String(m.id),
    name: String(m.name),
    kind: m.kind as Media['kind'],
    folder: String(m.folder),
    bytes: Number(m.bytes),
    sha256: String(m.sha256),
    width: m.width === null ? null : Number(m.width),
    height: m.height === null ? null : Number(m.height),
    duration_seconds: duration === null ? null : Math.round(duration * 1000) / 1000,
    sample_rate: m.sample_rate === null || m.sample_rate === undefined ? null : Number(m.sample_rate),
    used_in: used.rows.map((row) => row.title),
  };
}

export async function completeUpload(ctx: AppCtx, uploadId: string): Promise<{ duplicate: boolean; media: Media }> {
  const upload = await ctx.db.query('SELECT * FROM uploads WHERE id = $1', [uploadId]);
  if ((upload.rowCount ?? 0) === 0) throw new ApiError('not_found');
  const u = upload.rows[0]!;
  const chunks = Number(u.chunks);
  const received = await ctx.db.query<{ chunk_no: number }>('SELECT chunk_no FROM upload_chunks WHERE upload_id = $1 ORDER BY chunk_no', [uploadId]);
  const have = new Set(received.rows.map((row) => row.chunk_no));
  const missing: number[] = [];
  for (let i = 0; i < chunks; i++) {
    if (!have.has(i)) missing.push(i);
  }
  if (missing.length > 0) {
    throw new ApiError('upload_incomplete', { missing: missing.join(', ') }, { missing });
  }
  // While MinIO is unreachable, complete answers 503 at the assembly step.
  if (!ctx.storage.isUp()) throw new ApiError('storage_unavailable');
  const parts: Uint8Array[] = [];
  for (let i = 0; i < chunks; i++) {
    parts.push(await ctx.storage.get(`uploads/${uploadId}/${i}`));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const assembled = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    assembled.set(p, offset);
    offset += p.length;
  }
  const sha = sha256Hex(assembled);
  if (sha !== u.sha256) {
    await refuseUpload(ctx, u.id);
    throw new ApiError('upload_refused', { file: u.file_name, reason: 'checksum does not match' }, { reason: 'checksum does not match' });
  }
  const judged = judgeMedia(assembled, sha);
  if (!judged.ok) {
    await refuseUpload(ctx, u.id);
    throw new ApiError('upload_refused', { file: u.file_name, reason: judged.reason }, { reason: judged.reason });
  }
  const existing = await ctx.db.query('SELECT * FROM media WHERE sha256 = $1', [sha]);
  if ((existing.rowCount ?? 0) > 0) {
    await cleanupChunks(ctx, u.id, chunks);
    await giveBackTaken(ctx, u);
    return { duplicate: true, media: await mediaJson(ctx, existing.rows[0]!) };
  }
  // A replacement keeps the id and name, points at the new object.
  if (u.replaces !== null && u.replaces !== '') {
    const old = await ctx.db.query('SELECT * FROM media WHERE id = $1', [u.replaces]);
    if ((old.rowCount ?? 0) === 0) {
      await refuseUpload(ctx, u.id);
      throw new ApiError('upload_refused', { file: u.file_name, reason: 'unknown file type' }, { reason: 'unknown file type' });
    }
    const o = old.rows[0]!;
    if (o.kind !== judged.media.kind) {
      await refuseUpload(ctx, u.id);
      throw new ApiError('upload_refused', { file: u.file_name, reason: 'replacement must be the same type' }, { reason: 'replacement must be the same type' });
    }
    const uses = await ctx.db.query(
      `SELECT p.title, MAX(c.end_frame - c.start_frame) AS longest FROM clips c JOIN projects p ON p.id = c.project_id
       WHERE c.media_id = $1 GROUP BY p.title`, [o.id]);
    const mediaLength = judged.media.kind === 'wav' || judged.media.kind === 'mp4'
      ? judged.media.mp4 ?? { timescale: judged.media.wav!.sampleRate, duration: judged.media.wav!.sampleFrames }
      : null;
    void mediaLength;
    if (judged.media.mp4 !== undefined && uses.rows.length > 0) {
      const longestUse = Math.max(...uses.rows.map((row: { longest: number }) => Number(row.longest)));
      const sourceFrames = sourceFramesOf(judged.media);
      if (sourceFrames < longestUse) {
        const titles = uses.rows.map((row: { title: string }) => row.title).join(', ');
        await refuseUpload(ctx, u.id);
        throw new ApiError('upload_refused', { file: u.file_name, reason: `replacement is shorter than its use in ${titles}` }, { reason: `replacement is shorter than its use in ${titles}` });
      }
    }
    await ctx.storage.put(`media/${sha}`, assembled);
    await ctx.db.query(
      `UPDATE media SET sha256 = $2, bytes = $3, width = $4, height = $5, duration_timescale = $6, duration = $7,
        sample_rate = $8, sample_frames = $9, channels = $10, bits = $11 WHERE id = $1`,
      [o.id, sha, assembled.length, judged.media.mp4?.width ?? null, judged.media.mp4?.height ?? null,
        judged.media.mp4?.timescale ?? null, judged.media.mp4?.duration ?? null,
        judged.media.wav?.sampleRate ?? null, judged.media.wav?.sampleFrames ?? null,
        judged.media.wav?.channels ?? null, judged.media.wav?.bits ?? null],
    );
    await ctx.storage.remove(`media/${o.sha256}`).catch(() => undefined);
    await ctx.counters.deletePeaks(o.sha256);
    await ctx.counters.giveBackStorageBytes(Number(o.bytes));
    await cleanupChunks(ctx, u.id, chunks);
    await announceAllowance(ctx);
    const refreshed = await ctx.db.query('SELECT * FROM media WHERE id = $1', [o.id]);
    return { duplicate: false, media: await mediaJson(ctx, refreshed.rows[0]!) };
  }
  await ctx.storage.put(`media/${sha}`, assembled);
  const id = `m-${newHex(6)}`;
  await ctx.db.query(
    `INSERT INTO media (id, workspace_id, name, kind, folder, bytes, sha256, width, height, duration_timescale, duration, sample_rate, sample_frames, channels, bits)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, ctx.workspaceId, u.file_name, judged.media.kind, u.folder, assembled.length, sha,
      judged.media.mp4?.width ?? judged.media.png?.width ?? null,
      judged.media.mp4?.height ?? judged.media.png?.height ?? null,
      judged.media.mp4?.timescale ?? null, judged.media.mp4?.duration ?? null,
      judged.media.wav?.sampleRate ?? null, judged.media.wav?.sampleFrames ?? null,
      judged.media.wav?.channels ?? null, judged.media.wav?.bits ?? null],
  );
  await ctx.db.query("UPDATE uploads SET state = 'confirmed' WHERE id = $1", [u.id]);
  await cleanupChunks(ctx, u.id, chunks);
  await announceAllowance(ctx);
  const created = await ctx.db.query('SELECT * FROM media WHERE id = $1', [id]);
  return { duplicate: false, media: await mediaJson(ctx, created.rows[0]!) };
}

function sourceFramesOf(media: { mp4?: { timescale: number; duration: number }; wav?: { sampleRate: number; sampleFrames: number } }): number {
  // Source frames at 25 fps as a nominal comparison basis is not used; the
  // real per-project conversion happens when a clip is created.
  void media;
  return 0;
}

async function cleanupChunks(ctx: AppCtx, uploadId: string, chunks: number): Promise<void> {
  for (let i = 0; i < chunks; i++) {
    await ctx.storage.remove(`uploads/${uploadId}/${i}`).catch(() => undefined);
  }
  await ctx.db.query('DELETE FROM upload_chunks WHERE upload_id = $1', [uploadId]);
}

async function refuseUpload(ctx: AppCtx, uploadId: string): Promise<void> {
  const u = await ctx.db.query('SELECT chunks FROM uploads WHERE id = $1', [uploadId]);
  if ((u.rowCount ?? 0) > 0) {
    await cleanupChunks(ctx, uploadId, Number(u.rows[0]!.chunks));
  }
  await ctx.db.query("UPDATE uploads SET state = 'refused' WHERE id = $1", [uploadId]);
  await giveBackTaken(ctx, u.rows[0]!);
}

async function giveBackTaken(ctx: AppCtx, u: { bytes: number | string }): Promise<void> {
  await ctx.counters.giveBackStorageBytes(Number(u.bytes));
}
