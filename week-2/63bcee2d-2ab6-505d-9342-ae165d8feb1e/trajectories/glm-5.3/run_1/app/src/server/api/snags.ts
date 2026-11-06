// Viewpoints, the Intent seam's snags, renders and site photos.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, forbidden, illegalTransition, notFound, storageUnavailable, validationError, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import type { AuthedRequest } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { checkLength, parseMultipart, requireString, throwValidation, wrap } from './helpers.js';
import { detectImage, sha256Hex } from '../lib/files.js';
import { cleanPhoto } from '../lib/image.js';
import { hkToday } from '../lib/time.js';
import type { Config } from '../lib/config.js';
import type { Storage } from '../lib/s3.js';

const FILE_LIMIT = 10_000_000;

interface ViewpointRow {
  id: string;
  project_id: string;
  name: string;
  store_code: string;
  render_ext: string | null;
  photo_id: string | null;
}

async function viewpointById(id: string): Promise<ViewpointRow | null> {
  return one<ViewpointRow>('SELECT id, project_id, name, store_code, render_ext, photo_id FROM viewpoints WHERE id = $1', [id]);
}

async function scopedViewpoint(req: AuthedRequest, id: string): Promise<ViewpointRow> {
  const viewpoint = await viewpointById(id);
  if (!viewpoint) throw notFound();
  const project = await scopedProject(req, viewpoint.project_id);
  if (req.member!.role === 'client_approver') throw notFound();
  if (req.member!.role === 'contractor' && req.member!.companyId !== project.contractCompany) throw notFound();
  return viewpoint;
}

async function viewpointPayload(viewpoint: ViewpointRow): Promise<Record<string, unknown>> {
  const photo = viewpoint.photo_id
    ? await one<{ id: string; width: number; height: number }>('SELECT id, width, height FROM viewpoint_photos WHERE id = $1', [viewpoint.photo_id])
    : null;
  return {
    id: viewpoint.id,
    name: viewpoint.name,
    storeCode: viewpoint.store_code,
    hasRender: viewpoint.render_ext !== null,
    photoId: viewpoint.photo_id,
    photoDimensions: photo ? { width: photo.width, height: photo.height } : null,
  };
}

export function viewpointsRouter(config: Config, storage: Storage): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/projects/:id/viewpoints', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role === 'client_approver') throw notFound();
    if (member.role === 'contractor' && member.companyId !== project.contractCompany) throw notFound();
    const rows = await query<ViewpointRow>('SELECT id, project_id, name, store_code, render_ext, photo_id FROM viewpoints WHERE project_id = $1 ORDER BY name', [project.id]);
    res.json({ viewpoints: await Promise.all(rows.map(viewpointPayload)) });
  }));

  router.post('/api/projects/:id/viewpoints', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const name = requireString(body.name, 'name', 'Viewpoint name', errors);
    checkLength(name, 'name', 'Viewpoint name', 120, errors);
    const storeCode = requireString(body.storeCode, 'storeCode', 'Store', errors);
    if (storeCode) {
      const store = await one('SELECT id FROM stores WHERE project_id = $1 AND code = $2', [project.id, storeCode]);
      if (!store) errors.storeCode = FIELD_ERRORS.storeUnknown;
    }
    throwValidation(errors);
    const id = randomUUID();
    await query('INSERT INTO viewpoints (id, project_id, name, store_code) VALUES ($1,$2,$3,$4)', [id, project.id, name, storeCode]);
    res.status(201).json({ viewpoint: await viewpointPayload((await viewpointById(id))!) });
  }));

  router.put('/api/viewpoints/:id/render', express.raw({ type: 'multipart/form-data', limit: '10100000b' }), wrap(async (req, res) => {
    const member = req.member!;
    const viewpoint = await viewpointById(req.params.id);
    if (!viewpoint) throw notFound();
    const project = await scopedProject(req, viewpoint.project_id);
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const parsed = parseMultipart(req.body as Buffer, req.headers['content-type'] ?? '');
    const file = parsed.files.find((f) => f.fieldName === 'file');
    const errors: Record<string, string> = {};
    if (!file) errors.file = FIELD_ERRORS.required('Render');
    if (file && file.data.length > FILE_LIMIT) errors.file = FIELD_ERRORS.fileTooLarge(file.fileName, FILE_LIMIT);
    if (file && file.data.length > 0) {
      const kind = detectImage(file.data);
      if (!kind) errors.file = FIELD_ERRORS.unsupportedImage(file.fileName);
    }
    throwValidation(errors);
    const kind = detectImage(file!.data)!;
    try {
      const key = `projects/${project.id}/viewpoints/${viewpoint.id}/render.${kind.ext}`;
      await storage.put(key, file!.data, `image/${kind.ext === 'png' ? 'png' : 'jpeg'}`);
      await query('UPDATE viewpoints SET render_ext = $1 WHERE id = $2', [kind.ext, viewpoint.id]);
      res.json({ viewpoint: await viewpointPayload((await viewpointById(viewpoint.id))!) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw storageUnavailable();
    }
  }));

  router.post('/api/viewpoints/:id/photos', express.raw({ type: 'multipart/form-data', limit: '10100000b' }), wrap(async (req, res) => {
    const member = req.member!;
    const viewpoint = await viewpointById(req.params.id);
    if (!viewpoint) throw notFound();
    const project = await scopedProject(req, viewpoint.project_id);
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const parsed = parseMultipart(req.body as Buffer, req.headers['content-type'] ?? '');
    const file = parsed.files.find((f) => f.fieldName === 'file');
    const errors: Record<string, string> = {};
    if (!file) errors.file = FIELD_ERRORS.required('Photo');
    if (file && file.data.length > FILE_LIMIT) errors.file = FIELD_ERRORS.fileTooLarge(file.fileName, FILE_LIMIT);
    if (file && file.data.length > 0) {
      const kind = detectImage(file.data);
      if (!kind) errors.file = FIELD_ERRORS.unsupportedImage(file.fileName);
    }
    throwValidation(errors);
    const kind = detectImage(file!.data)!;
    try {
      // Strip location data and apply camera orientation to the pixels.
      const cleaned = cleanPhoto(file!.data, kind.kind);
      const photoId = randomUUID();
      const key = `projects/${project.id}/viewpoints/${viewpoint.id}/photos/${photoId}.${cleaned.ext}`;
      await storage.put(key, cleaned.buffer, cleaned.contentType);
      await query(
        'INSERT INTO viewpoint_photos (id, viewpoint_id, width, height, ext, bytes, sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [photoId, viewpoint.id, cleaned.width, cleaned.height, cleaned.ext, cleaned.buffer.length, sha256Hex(cleaned.buffer)],
      );
      await query('UPDATE viewpoints SET photo_id = $1 WHERE id = $2', [photoId, viewpoint.id]);
      res.status(201).json({ photo: { id: photoId, width: cleaned.width, height: cleaned.height } });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw storageUnavailable();
    }
  }));

  router.get('/api/viewpoints/:id/render', wrap(async (req, res) => {
    const viewpoint = await scopedViewpoint(req, req.params.id);
    if (!viewpoint.render_ext) throw notFound();
    const project = await scopedProject(req, viewpoint.project_id);
    try {
      const data = await storage.get(`projects/${project.id}/viewpoints/${viewpoint.id}/render.${viewpoint.render_ext}`);
      res.setHeader('Content-Type', `image/${viewpoint.render_ext === 'png' ? 'png' : 'jpeg'}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(data);
    } catch {
      throw storageUnavailable();
    }
  }));

  router.get('/api/viewpoints/:id/photo', wrap(async (req, res) => {
    const viewpoint = await scopedViewpoint(req, req.params.id);
    if (!viewpoint.photo_id) throw notFound();
    const photo = await one<{ ext: string }>('SELECT ext FROM viewpoint_photos WHERE id = $1', [viewpoint.photo_id]);
    if (!photo) throw notFound();
    const project = await scopedProject(req, viewpoint.project_id);
    try {
      const data = await storage.get(`projects/${project.id}/viewpoints/${viewpoint.id}/photos/${viewpoint.photo_id}.${photo.ext}`);
      res.setHeader('Content-Type', `image/${photo.ext === 'png' ? 'png' : 'jpeg'}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(data);
    } catch {
      throw storageUnavailable();
    }
  }));

  // ---- Snags ----

  router.get('/api/viewpoints/:id/snags', wrap(async (req, res) => {
    const viewpoint = await scopedViewpoint(req, req.params.id);
    const rows = await query<{
      id: string; number: number; s: number; y: number; title: string; note: string | null;
      observed_on: string; state: 'open' | 'fixed' | 'closed' | 'reopened'; version: number;
    }>(
      'SELECT id, number, s, y, title, note, observed_on, state, version FROM snags WHERE viewpoint_id = $1 ORDER BY number',
      [viewpoint.id],
    );
    res.json({
      snags: rows.map((row) => ({
        id: row.id,
        number: row.number,
        s: row.s,
        y: row.y,
        title: row.title,
        note: row.note,
        observedOn: row.observed_on,
        state: row.state,
        version: row.version,
      })),
    });
  }));

  router.post('/api/viewpoints/:id/snags', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const viewpoint = await viewpointById(req.params.id);
    if (!viewpoint) throw notFound();
    const project = await scopedProject(req, viewpoint.project_id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const s = body.s;
    const y = body.y;
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 0 || s > 100) errors.s = FIELD_ERRORS.range('Across', '0 and 100');
    if (typeof y !== 'number' || !Number.isInteger(y) || y < 0 || y > 100) errors.y = FIELD_ERRORS.range('Height', '0 and 100');
    const title = requireString(body.title, 'title', 'Snag title', errors);
    if (title) checkLength(title, 'title', 'Snag title', 120, errors);
    const note = typeof body.note === 'string' ? body.note : '';
    if (note && [...note].length > 500) errors.note = FIELD_ERRORS.tooLong('Note', 500);
    const observedOn = requireString(body.observedOn, 'observedOn', 'Observed on', errors);
    if (observedOn && !/^\d{4}-\d{2}-\d{2}$/.test(observedOn)) errors.observedOn = 'Observed on must be a date.';
    if (observedOn && /^\d{4}-\d{2}-\d{2}$/.test(observedOn)) {
      if (observedOn > hkToday()) errors.observedOn = FIELD_ERRORS.futureDate('Observed on');
      if (project.defectsEndOn && observedOn > project.defectsEndOn) {
        errors.observedOn = FIELD_ERRORS.snagAfterDefects(project.defectsEndOn);
      }
    }
    throwValidation(errors);
    const created = await withTransaction(async (client) => {
      const numberRow = await client.query<Record<'value', string>>(
        `INSERT INTO counter_state (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value`,
        [`snag_seq_${viewpoint.id}`],
      );
      const number = parseInt(numberRow.rows[0].value, 10);
      const id = randomUUID();
      await client.query(
        'INSERT INTO snags (id, viewpoint_id, number, s, y, title, note, observed_on, raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, viewpoint.id, number, s, y, title, note || null, observedOn, member.id],
      );
      return id;
    });
    const row = await one<{ id: string; number: number; s: number; y: number; title: string; note: string | null; observed_on: string; state: string; version: number }>(
      'SELECT id, number, s, y, title, note, observed_on, state, version FROM snags WHERE id = $1',
      [created],
    );
    res.status(201).json({ snag: row });
  }));

  router.patch('/api/snags/:id', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const snag = await one<{ id: string; viewpoint_id: string; state: string }>('SELECT id, viewpoint_id, state FROM snags WHERE id = $1', [req.params.id]);
    if (!snag) throw notFound();
    const viewpoint = await viewpointById(snag.viewpoint_id);
    if (!viewpoint) throw notFound();
    await scopedProject(req, viewpoint.project_id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    let s: number | undefined;
    let y: number | undefined;
    if (body.s !== undefined) {
      if (typeof body.s !== 'number' || !Number.isInteger(body.s) || body.s < 0 || body.s > 100) errors.s = FIELD_ERRORS.range('Across', '0 and 100');
      else s = body.s;
    }
    if (body.y !== undefined) {
      if (typeof body.y !== 'number' || !Number.isInteger(body.y) || body.y < 0 || body.y > 100) errors.y = FIELD_ERRORS.range('Height', '0 and 100');
      else y = body.y;
    }
    const title = typeof body.title === 'string' ? body.title : undefined;
    if (title !== undefined) checkLength(title, 'title', 'Snag title', 120, errors);
    const note = typeof body.note === 'string' ? body.note : undefined;
    if (note !== undefined && [...note].length > 500) errors.note = FIELD_ERRORS.tooLong('Note', 500);
    throwValidation(errors);
    await withTransaction(async (client) => {
      const locked = (await client.query('SELECT state, version FROM snags WHERE id = $1 FOR UPDATE', [snag.id])).rows[0] as
        | { state: string; version: number }
        | undefined;
      if (!locked) throw notFound();
      if (locked.state === 'closed') throw illegalTransition('closed', 'move');
      await client.query(
        `UPDATE snags SET s = COALESCE($1, s), y = COALESCE($2, y), title = COALESCE($3, title), note = COALESCE($4, note), version = version + 1, updated_at = now() WHERE id = $5`,
        [s ?? null, y ?? null, title ?? null, note ?? null, snag.id],
      );
    });
    const fresh = await one<{ id: string; number: number; s: number; y: number; title: string; note: string | null; observed_on: string; state: string; version: number }>(
      'SELECT id, number, s, y, title, note, observed_on, state, version FROM snags WHERE id = $1',
      [snag.id],
    );
    res.json({ snag: fresh });
  }));

  router.post('/api/snags/:id/transitions', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const snag = await one<{ id: string; viewpoint_id: string; state: string }>('SELECT id, viewpoint_id, state FROM snags WHERE id = $1', [req.params.id]);
    if (!snag) throw notFound();
    const viewpoint = await viewpointById(snag.viewpoint_id);
    if (!viewpoint) throw notFound();
    const project = await scopedProject(req, viewpoint.project_id);
    if (member.role === 'client_approver') throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!['fix', 'close', 'reopen'].includes(action)) throw validationError({ action: 'Choose an action.' });
    if (action === 'fix') {
      const allowed =
        ['director', 'project_lead', 'designer'].includes(member.role) ||
        (member.role === 'contractor' && member.companyId === project.contractCompany);
      if (!allowed) throw forbidden();
      if (snag.state !== 'open' && snag.state !== 'reopened') throw illegalTransition(snag.state, action);
    }
    if (action === 'close') {
      if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
      if (snag.state !== 'fixed') throw illegalTransition(snag.state, action);
    }
    if (action === 'reopen') {
      if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
      if (snag.state !== 'fixed' && snag.state !== 'closed') throw illegalTransition(snag.state, action);
    }
    const nextState = action === 'fix' ? 'fixed' : action === 'close' ? 'closed' : 'reopened';
    await withTransaction(async (client) => {
      const locked = (await client.query('SELECT state FROM snags WHERE id = $1 FOR UPDATE', [snag.id])).rows[0] as { state: string } | undefined;
      if (!locked) throw notFound();
      await client.query('UPDATE snags SET state = $1, version = version + 1, updated_at = now() WHERE id = $2', [nextState, snag.id]);
    });
    const fresh = await one<{ id: string; number: number; s: number; y: number; title: string; note: string | null; observed_on: string; state: string; version: number }>(
      'SELECT id, number, s, y, title, note, observed_on, state, version FROM snags WHERE id = $1',
      [snag.id],
    );
    res.json({ snag: fresh });
  }));

  return router;
}
