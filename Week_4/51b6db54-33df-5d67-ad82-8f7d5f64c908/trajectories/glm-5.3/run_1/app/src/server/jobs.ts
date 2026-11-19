import type { Express } from 'express';
import { PNG } from 'pngjs';
import GifReader from 'omggif';
import { q, one } from './db.js';
import { notFound, forbidden, conflict, fieldErrors, storageUnavailable } from './errors.js';
import { now } from './clock.js';
import { requireUser, config } from './http.js';
import { getSprite, getLayers, getFrames, celRows, blankRows, nextSeq, writeCel } from './sprites.js';
import { requireMember, recordActivity } from './projects.js';
import { frameComposite } from './render.js';
import { putVerified, getObject, deleteObject, StorageDown, storageHealthy } from './storage.js';
import { sha256Hex, slugify, safeFileName } from './config.js';
import { formatNumber, rh, makeColorOf, bytesToHex } from '../shared/rules.js';
import { paletteSwatches } from './render.js';

function editorOnly(role: string, action: 'draw' | 'artwork' | 'export'): void {
  if (role === 'reviewer') {
    throw forbidden(action === 'export' ? "Reviewers can't export" : action === 'draw' ? "Reviewers can't draw" : "Reviewers can't change artwork");
  }
}

export function registerJobRoutes(app: Express): void {
  // ---- image import ----
  app.post('/api/projects/:id/imports', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      const role = await requireMember(projectId, user.id);
      editorOnly(role, 'artwork');
      const file = (req as unknown as { file?: { name: string; data: Buffer } }).file;
      if (!file) throw fieldErrors({ file: 'Choose a PNG or GIF file' });
      const data = file.data;
      const fileName = safeFileName(file.name);
      const format = sniffFormat(data);
      const nf = user.number_format === 'en-IN' ? 'en-IN' : 'en-US';
      const n = (v: number): string => formatNumber(v, nf);
      if (!format) throw fieldErrors({ file: 'Not a PNG or GIF image' });
      if (data.length > config.importMaxBytes) throw fieldErrors({ file: `File is larger than ${n(config.importMaxBytes)} bytes` });
      const decoded = decodeImage(data, format);
      if (decoded.width > config.spriteMax || decoded.height > config.spriteMax) {
        throw fieldErrors({ file: `Image is ${n(decoded.width)} by ${n(decoded.height)}, limit ${n(config.spriteMax)}` });
      }
      // build colour table, first-appearance order, excluding fully transparent
      const distinct = new Map<string, number>();
      for (const f of decoded.frames) {
        for (const row of f.rows) {
          for (const rgba of row) {
            if (rgba === null) continue;
            const hex = bytesToHex(rgba[0], rgba[1], rgba[2], rgba[3]);
            if (!distinct.has(hex)) distinct.set(hex, distinct.size + 1);
          }
        }
      }
      if (distinct.size > config.paletteMax) {
        throw fieldErrors({ file: `Needs ${n(distinct.size)} colours, limit ${n(config.paletteMax)}` });
      }
      // map colours to swatch indices
      const colors = [...distinct.entries()].sort((a, b) => a[1] - b[1]).map(([hex]) => hex);
      const colorToSwatch = new Map<string, number>();
      colors.forEach((hex, i) => colorToSwatch.set(hex, i + 1));
      // map colours to swatch indices; converted rows hold plain indices
      const indexFrames: number[][][] = decoded.frames.map((f) =>
        f.rows.map((row) => row.map((rgba) =>
          rgba === null ? 0 : colorToSwatch.get(bytesToHex(rgba[0], rgba[1], rgba[2], rgba[3]))!
        ))
      );
      // all or nothing: the object is stored first; if the store fails neither remains
      const at = await now();
      try {
        const palette = await one<{ id: string }>('insert into palettes (sprite_id, seq_at_creation) values (0, 0) returning id::text');
        const spriteName = fileName.replace(/\.(png|gif)$/i, '') || fileName;
        const sprite = await one<{ id: string }>(
          'insert into sprites (project_id, palette_id, name, width, height, seq, created_at) values ($1, $2, $3, $4, $5, 0, $6) returning id::text',
          [projectId, palette!.id, spriteName, decoded.width, decoded.height, at]
        );
        await q('update palettes set sprite_id = $1 where id = $2', [sprite!.id, palette!.id]);
        for (let i = 0; i < colors.length; i++) {
          await q('insert into swatches (palette_id, index, color, version, last_version) values ($1, $2, $3, 1, 1)',
            [palette!.id, i + 1, colors[i]]);
        }
        await q('insert into layers (sprite_id, name, opacity, blend, visible, locked_by, position) values ($1, $2, 100, $3, true, null, 1)',
          [sprite!.id, 'Layer 1', 'normal']);
        const layer = await one<{ id: string }>('select id::text from layers where sprite_id = $1', [sprite!.id]);
        for (let i = 0; i < decoded.frames.length; i++) {
          const duration = Math.min(config.frameMaxMs, Math.max(config.frameMinMs, decoded.frames[i].delayMs ?? 100));
          const frame = await one<{ id: string }>(
            'insert into frames (sprite_id, position, duration_ms) values ($1, $2, $3) returning id::text',
            [sprite!.id, i + 1, decoded.frames.length === 1 && format === 'png' ? 100 : duration]
          );
          await writeCel(Number(frame!.id), Number(layer!.id), indexFrames[i]);
        }
        const objectKey = `imports/${projectId}/${Date.now()}-${fileName}`;
        await putVerified(objectKey, data, sha256Hex(data));
        const imp = await one<{ id: string }>(
          'insert into imports (project_id, sprite_id, file_name, object_key, created_at) values ($1, $2, $3, $4, $5) returning id::text',
          [projectId, sprite!.id, fileName, objectKey, at]
        );
        res.status(201).json({ import: Number(imp!.id), sprite: Number(sprite!.id), file_name: fileName, colours: colors.length });
      } catch (e) {
        if (e instanceof StorageDown) throw storageUnavailable();
        throw e;
      }
    } catch (e) {
      if (e instanceof StorageDown) { next(storageUnavailable()); return; }
      next(e);
    }
  });

  app.get('/api/imports/:id/original', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ object_key: string; file_name: string; project_id: string }>(
        'select object_key, file_name, project_id::text from imports where id = $1', [req.params.id]
      );
      if (!row) throw notFound();
      await requireMember(Number(row.project_id), user.id);
      try {
        const data = await getObject(row.object_key);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
        res.send(data);
      } catch (e) {
        if (e instanceof StorageDown) throw storageUnavailable();
        throw e;
      }
    } catch (e) { next(e); }
  });

  // ---- exports ----
  app.post('/api/sprites/:id/exports', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      editorOnly(role, 'export');
      if (!(await storageHealthy())) throw storageUnavailable();
      const job = await startSpriteExport(Number(sprite.id), sprite, req.body as Record<string, unknown>, user.id);
      res.status(202).json({ job: job.id });
    } catch (e) { next(e); }
  });

  app.post('/api/projects/:id/exports', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      const role = await requireMember(projectId, user.id);
      editorOnly(role, 'export');
      if (!(await storageHealthy())) throw storageUnavailable();
      const job = await startProjectExport(projectId, req.body as Record<string, unknown>, user.id);
      res.status(202).json({ job: job.id });
    } catch (e) { next(e); }
  });
  app.get('/api/projects/:id/exports', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireMember(projectId, user.id);
      const rows = await q<{ id: string; job: string; label: string | null; seq: number; files: { name: string; size: number; sha256: string }[] }>(
        `select e.id::text, e.job_id::text as job, e.label, e.seq, e.files from exports e where e.project_id = $1 order by e.id desc`,
        [projectId]
      );
      res.json({ exports: rows.map((r) => ({ id: Number(r.id), job: Number(r.job), label: r.label, state: 'stored', seq: r.seq, files: r.files })) });
    } catch (e) { next(e); }
  });

  app.get('/api/jobs/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const job = await one<{ id: string; state: string; done: number; total: number; files: unknown }>(
        'select id::text, state, done, total, files from export_jobs where id = $1', [req.params.id]
      );
      if (!job) throw notFound();
      const sprite = job ? await one<{ project_id: string }>('select project_id::text from sprites where id = (select sprite_id from export_jobs where id = $1)', [job.id]) : null;
      const project = await one<{ project_id: string }>('select project_id::text from export_jobs where id = $1', [job.id]);
      await requireMember(Number(project!.project_id), user.id);
      res.json({ id: Number(job.id), state: job.state, done: job.done, total: job.total, files: job.files });
    } catch (e) { next(e); }
  });

  app.get('/api/jobs/:id/events', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const project = await one<{ project_id: string }>('select project_id::text from export_jobs where id = $1', [req.params.id]);
      if (!project) throw notFound();
      await requireMember(Number(project.project_id), user.id);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      const send = (row: { state: string; done: number; total: number; files: unknown }): void => {
        res.write(`data: ${JSON.stringify({ state: row.state, done: row.done, total: row.total, files: row.files })}\n\n`);
      };
      const latest = async (): Promise<{ state: string; done: number; total: number; files: unknown } | null> => {
        const row = await one<{ state: string; done: number; total: number; files: unknown }>(
          'select state, done, total, files from export_jobs where id = $1', [req.params.id]
        );
        return row;
      };
      let closed = false;
      const poll = async (): Promise<void> => {
        while (!closed) {
          const row = await latest();
          if (!row) { close(); return; }
          send(row);
          if (['stored', 'failed', 'cancelled'].includes(row.state)) { close(); return; }
          await new Promise((r) => setTimeout(r, 300));
        }
      };
      const close = (): void => { closed = true; res.end(); };
      req.on('close', () => { closed = true; });
      void poll();
    } catch (e) { next(e); }
  });

  app.post('/api/jobs/:id/cancel', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const project = await one<{ project_id: string }>('select project_id::text from export_jobs where id = $1', [req.params.id]);
      if (!project) throw notFound();
      await requireMember(Number(project.project_id), user.id);
      const row = await one<{ state: string; done: number; total: number }>(
        'select state, done, total from export_jobs where id = $1', [req.params.id]
      );
      if (['stored', 'failed', 'cancelled'].includes(row!.state)) {
        throw conflict('job_finished', { state: row!.state });
      }
      await q('update export_jobs set state = $1 where id = $2', ['cancelled', req.params.id]);
      res.json({ state: 'cancelled', done: row!.done, total: row!.total });
    } catch (e) { next(e); }
  });

  app.get('/api/exports/:id/files/:name', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ project_id: string; job_id: string; files: { name: string }[] }>(
        'select project_id::text, job_id::text, files from exports where id = $1', [req.params.id]
      );
      if (!row) throw notFound();
      await requireMember(Number(row.project_id), user.id);
      const wanted = row.files.find((f) => f.name === req.params.name);
      if (!wanted) throw notFound();
      const objectKey = `exports/${row.project_id}/${row.job_id}/${req.params.name}`;
      try {
        const data = await getObject(objectKey);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(data);
      } catch (e) {
        if (e instanceof StorageDown) throw storageUnavailable();
        throw e;
      }
    } catch (e) { next(e); }
  });
}

interface DecodedFrame { rows: ([number, number, number, number] | null)[][]; delayMs: number }

/** Validate and queue a sprite export job. */
async function startSpriteExport(spriteId: number, sprite: { id: string; name: string; seq: number }, body: Record<string, unknown>, ownerId: number): Promise<{ id: number }> {
  const format = String(body['format'] ?? 'png');
  const scale = Number(body['scale'] ?? 1);
  const frame = body['frame'] === undefined ? null : Number(body['frame']);
  const padding = Number(body['padding'] ?? 0);
  const extrude = Number(body['extrude'] ?? 0);
  const label = body['label'] === undefined ? null : String(body['label']);
  const errors: Record<string, string> = {};
  if (!['png', 'gif', 'sheet'].includes(format)) errors['format'] = 'Use PNG, GIF or Sheet';
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) errors['scale'] = 'Use 1 to 16';
  if (format === 'png' && frame === null) errors['frame'] = 'Choose a frame';
  if (format !== 'png' && frame !== null) errors['frame'] = 'Frame is for PNG only';
  if (format === 'sheet') {
    if (!Number.isInteger(padding) || padding < 0 || padding > 64) errors['padding'] = 'Use 0 to 64';
    if (!Number.isInteger(extrude) || extrude < 0 || extrude > 16) errors['extrude'] = 'Use 0 to 16';
  } else {
    if (padding !== 0) errors['padding'] = 'Padding is for Sheet only';
    if (extrude !== 0) errors['extrude'] = 'Extrude is for Sheet only';
  }
  if (Object.keys(errors).length) throw fieldErrors(errors);
  const kind = format === 'png' ? 'png' : format === 'gif' ? 'gif' : 'sheet';
  const row = await one<{ id: string }>(
    `insert into export_jobs (project_id, sprite_id, kind, label, scale, frame, padding, extrude, state, done, total, seq, owner_id, files, created_at)
     select project_id, $1, $2, $3, $4, $5, $6, $7, 'queued', 0, 0, seq, $8, '[]', $9 from sprites where id = $1 returning id::text`,
    [sprite.id, kind, label, scale, frame, format === 'sheet' ? padding : 0, format === 'sheet' ? extrude : 0, ownerId, await now()]
  );
  return { id: Number(row!.id) };
}

/** Validate and queue a project export job. */
async function startProjectExport(projectId: number, body: Record<string, unknown>, ownerId: number): Promise<{ id: number }> {
  const scale = Number(body['scale'] ?? 1);
  const padding = Number(body['padding'] ?? 0);
  const extrude = Number(body['extrude'] ?? 0);
  const label = body['label'] === undefined ? null : String(body['label']);
  const errors: Record<string, string> = {};
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) errors['scale'] = 'Use 1 to 16';
  if (!Number.isInteger(padding) || padding < 0 || padding > 64) errors['padding'] = 'Use 0 to 64';
  if (!Number.isInteger(extrude) || extrude < 0 || extrude > 16) errors['extrude'] = 'Use 0 to 16';
  if (Object.keys(errors).length) throw fieldErrors(errors);
  const sprite = await one<{ seq: number }>('select seq from sprites where project_id = $1 order by id asc limit 1', [projectId]);
  const seq = sprite?.seq ?? 0;
  const row = await one<{ id: string }>(
    `insert into export_jobs (project_id, sprite_id, kind, label, scale, frame, padding, extrude, state, done, total, seq, owner_id, files, created_at)
     values ($1, null, 'project', $2, $3, null, $4, $5, 'queued', 0, 0, $6, $7, '[]', $8) returning id::text`,
    [projectId, label, scale, padding, extrude, seq, ownerId, await now()]
  );
  return { id: Number(row!.id) };
}

function sniffFormat(data: Buffer): 'png' | 'gif' | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
  if (data.length > 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'gif';
  return null;
}

function decodeImage(data: Buffer, format: 'png' | 'gif'): { width: number; height: number; frames: DecodedFrame[] } {
  if (format === 'png') {
    const png = PNG.sync.read(data);
    const rows: ([number, number, number, number] | null)[][] = [];
    for (let y = 0; y < png.height; y++) {
      const row: ([number, number, number, number] | null)[] = [];
      for (let x = 0; x < png.width; x++) {
        const o = (y * png.width + x) * 4;
        row.push(png.data[o + 3] === 0 ? null : [png.data[o], png.data[o + 1], png.data[o + 2], png.data[o + 3]]);
      }
      rows.push(row);
    }
    return { width: png.width, height: png.height, frames: [{ rows, delayMs: 100 }] };
  }
  const reader = new GifReader(new Uint8Array(data));
  const frames: DecodedFrame[] = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    const pixels = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(i, pixels);
    const rows: ([number, number, number, number] | null)[][] = [];
    for (let y = 0; y < reader.height; y++) {
      const row: ([number, number, number, number] | null)[] = [];
      for (let x = 0; x < reader.width; x++) {
        const o = (y * reader.width + x) * 4;
        row.push(pixels[o + 3] === 0 ? null : [pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3]]);
      }
      rows.push(row);
    }
    frames.push({ rows, delayMs: info.delay * 10 });
  }
  return { width: reader.width, height: reader.height, frames };
}
