import { Router } from 'express';
import type { Request, Response } from 'express';
import type { App } from '../app';
import { ApiError } from '../errors';
import { newId, loadEngagement, loadEngagementRow, buildQuote, serializeIntakeFile } from '../domain';
import { intakeKey } from '../services/storage';
import { requireClient, type ClientSession } from '../middleware';
import { validateGlb, GlbError } from '../glb';
import type { ExportUnit, IntakeFile } from '../types';
import { refreshOverdue, refreshOverdueForInvoice } from '../invoices';

/**
 * Client routes. Brand scoping is decided here: every id the client sends
 * must belong to the signed-in brand, otherwise the not-found response.
 */

function sessionOf(req: Request): ClientSession {
  return (req as unknown as { session: ClientSession }).session;
}

const CONTENT_TYPES: Record<string, string> = {
  model: 'model/gltf-binary',
  step: 'model/step',
  reference: 'application/pdf',
};

const FILE_CAPS: Record<string, number> = {
  model: 250_000_000,
  step: 250_000_000,
  reference: 25_000_000,
};

function displayName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.slice(0, 120);
}

function detectKind(name: string, head: Buffer): 'model' | 'step' | 'reference' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.glb')) {
    return head.subarray(0, 4).toString('ascii') === 'glTF' ? 'model' : null;
  }
  if (lower.endsWith('.step') || lower.endsWith('.stp')) {
    const text = head.toString('latin1').replace(/^[\s\u0000-\u0020]*/, '');
    return text.startsWith('ISO-10303-21;') ? 'step' : null;
  }
  if (lower.endsWith('.pdf')) {
    return head.subarray(0, 5).toString('ascii') === '%PDF-' ? 'reference' : null;
  }
  return null;
}

function param(req: { params: Record<string, string | string[]> }, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

export function clientRoutes(app: App): Router {
  const router = Router();
  router.use(['/api/engagements', '/api/engagements/'], requireClient(app));

  router.get('/api/engagements', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const result = await app.pool.query(
        `SELECT id, reference, title, state FROM engagements WHERE brand_id = $1 ORDER BY created_at ASC, reference ASC`,
        [session.brandId],
      );
      res.json({ engagements: result.rows.map(row => ({ id: row.id, reference: row.reference, title: row.title, state: row.state })) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/engagements', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = req.body as Record<string, unknown>;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (title.length < 1 || title.length > 120) {
        throw new ApiError('validation_failed', { title: 'Enter a project title.' });
      }
      const brand = await app.pool.query(`SELECT currency FROM brands WHERE id = $1`, [session.brandId]);
      const currency = brand.rows[0].currency as 'EUR' | 'GBP' | 'USD' | 'JPY';
      const rate = currency === 'GBP' ? '1.0000' : await (await import('../domain')).rateInEffect(app.pool, currency);
      const client = await app.pool.connect();
      let engagementId = '';
      try {
        await client.query('BEGIN');
        const counter = await client.query(`SELECT nextval('engagement_reference_seq') AS n`);
        engagementId = newId();
        await client.query(
          `INSERT INTO engagements (id, brand_id, reference, title, state, fx_rate) VALUES ($1, $2, $3, $4, 'quoted', $5)`,
          [engagementId, session.brandId, `GW-${counter.rows[0].n}`, title, rate],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const engagement = await loadEngagement(app, engagementId, { onlyIssuedInvoices: false });
      res.status(201).json(engagement);
    } catch (error) {
      next(error);
    }
  });

  async function ownedEngagement(req: Request, res: Response, engagementId: string) {
    const session = sessionOf(req);
    const row = await loadEngagementRow(app.pool, engagementId);
    if (row === null || row.brand_id !== session.brandId) {
      res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
      return null;
    }
    await refreshOverdue(app, row);
    return row;
  }

  router.get('/api/engagements/:id', async (req, res, next) => {
    try {
      const row = await ownedEngagement(req, res, param(req, 'id'));
      if (!row) {
        return;
      }
      const engagement = await loadEngagement(app, row.id);
      res.json(engagement);
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/engagements/:id/quote/lines/:shotCode', async (req, res, next) => {
    try {
      const row = await ownedEngagement(req, res, param(req, 'id'));
      if (!row) {
        return;
      }
      if (row.quote_locked) {
        throw new ApiError('quote_locked');
      }
      const services = await (await import('../domain')).loadServices(app);
      const service = services.find(s => s.code === param(req, 'shotCode'));
      if (!service) {
        throw new ApiError('not_found');
      }
      const body = req.body as Record<string, unknown>;
      const quantity = body.quantity;
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
        throw new ApiError('validation_failed', { quantity: 'Choose between 1 and 6 colourways.' });
      }
      await app.pool.query(
        `INSERT INTO quote_lines (id, engagement_id, shot_code, quantity) VALUES ($1, $2, $3, $4)
         ON CONFLICT (engagement_id, shot_code) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [newId(), row.id, service.code, quantity],
      );
      await app.pool.query(`UPDATE engagements SET revision = revision + 1 WHERE id = $1`, [row.id]);
      const fresh = await loadEngagementRow(app.pool, row.id);
      const quote = await buildQuote(app, fresh as never);
      res.json(quote);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/engagements/:id/quote/lines/:shotCode', async (req, res, next) => {
    try {
      const row = await ownedEngagement(req, res, param(req, 'id'));
      if (!row) {
        return;
      }
      if (row.quote_locked) {
        throw new ApiError('quote_locked');
      }
      await app.pool.query(
        `DELETE FROM quote_lines WHERE engagement_id = $1 AND shot_code = $2`,
        [row.id, param(req, 'shotCode')],
      );
      await app.pool.query(`UPDATE engagements SET revision = revision + 1 WHERE id = $1`, [row.id]);
      const fresh = await loadEngagementRow(app.pool, row.id);
      const quote = await buildQuote(app, fresh as never);
      res.json(quote);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/engagements/:id/files', async (req, res, next) => {
    const session = sessionOf(req);
    const engagementId = param(req, 'id');
    const row = await loadEngagementRow(app.pool, engagementId);
    if (row === null || row.brand_id !== session.brandId) {
      res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
      return;
    }
    try {
      // Manual multipart streaming with content sniffing and cap enforcement.
      const contentType = req.headers['content-type'] ?? '';
      const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
      if (!boundaryMatch) {
        throw new ApiError('file_type_mismatch');
      }
      const { parseMultipartStream } = await import('../upload');
      const uploaded = await parseMultipartStream(req, boundaryMatch[1] ?? boundaryMatch[2], {
        maxFileBytes: 250_000_000,
        onFileStart: (fileName) => {
          const name = displayName(fileName);
          if (name.toLowerCase().endsWith('.glb') && row.quote_locked) {
            throw new ApiError('quote_locked');
          }
          return name;
        },
        sniff: (name, head) => detectKind(name, head),
        caps: FILE_CAPS,
        validateGlb: (buffer) => {
          try {
            validateGlb(buffer);
            return null;
          } catch (error) {
            if (error instanceof GlbError) {
              return new ApiError('gltf_malformed');
            }
            return new ApiError('gltf_malformed');
          }
        },
      });
      if (!uploaded.file || uploaded.file.length === 0) {
        throw new ApiError('file_type_mismatch');
      }
      const kind = uploaded.fileKind as 'model' | 'step' | 'reference';
      const fileId = newId();
      const ext = kind === 'model' ? 'glb' : kind === 'step' ? 'step' : 'pdf';
      const key = intakeKey(engagementId, fileId, ext);
      const { Readable } = await import('node:stream');
      const stream = Readable.from([uploaded.file.data]);
      try {
        await app.storage.putObject(key, stream, uploaded.file.length, CONTENT_TYPES[kind]);
        await app.storage.statObject(key);
      } catch {
        await app.storage.removeIncompleteUpload(key).catch(() => undefined);
        throw new ApiError('storage_unavailable');
      }
      const result = await app.pool.query(
        `INSERT INTO intake_files (id, engagement_id, name, kind, size_bytes, status)
         VALUES ($1, $2, $3, $4, $5, 'received') RETURNING *`,
        [fileId, engagementId, uploaded.file.name, kind, uploaded.file.length],
      );
      if (kind === 'model') {
        // A new GLB supersedes the previous model and resets the unit decision.
        await app.pool.query(
          `UPDATE intake_files SET status = 'superseded', unit = NULL, unit_confirmed = FALSE
           WHERE engagement_id = $1 AND id <> $2 AND kind = 'model' AND status = 'received'`,
          [engagementId, fileId],
        );
        try {
          await app.queue.publish(fileId);
          await app.pool.query(`UPDATE intake_files SET measurement = 'pending' WHERE id = $1`, [fileId]);
        } catch {
          await app.pool.query(`UPDATE intake_files SET measurement = 'delayed' WHERE id = $1`, [fileId]);
        }
      }
      const file = serializeIntakeFile(result.rows[0]);
      res.status(201).json(file);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/engagements/:id/files/:fileId/content', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const row = await loadEngagementRow(app.pool, param(req, 'id'));
      if (row === null || row.brand_id !== session.brandId) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const file = await app.pool.query(
        `SELECT * FROM intake_files WHERE id = $1 AND engagement_id = $2`,
        [param(req, 'fileId'), param(req, 'id')],
      );
      if (file.rows.length === 0) {
        throw new ApiError('not_found');
      }
      const record = file.rows[0];
      const ext = record.kind === 'model' ? 'glb' : record.kind === 'step' ? 'step' : 'pdf';
      const key = intakeKey(param(req, 'id'), record.id, ext);
      try {
        const stream = await app.storage.getObject(key);
        res.setHeader('Content-Type', CONTENT_TYPES[record.kind]);
        res.setHeader('Content-Length', String(record.size_bytes));
        res.setHeader('Content-Disposition', downloadDisposition(record.name));
        stream.pipe(res);
      } catch {
        throw new ApiError('storage_unavailable');
      }
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/engagements/:id/files/:fileId/unit', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const row = await loadEngagementRow(app.pool, param(req, 'id'));
      if (row === null || row.brand_id !== session.brandId) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      if (row.quote_locked) {
        throw new ApiError('quote_locked');
      }
      const file = await app.pool.query(
        `SELECT * FROM intake_files WHERE id = $1 AND engagement_id = $2`,
        [param(req, 'fileId'), param(req, 'id')],
      );
      if (file.rows.length === 0) {
        throw new ApiError('not_found');
      }
      const record = file.rows[0];
      if (record.kind !== 'model') {
        throw new ApiError('validation_failed', { unit: 'Only a GLB model has an export unit.' });
      }
      if (record.measurement !== 'measured') {
        throw new ApiError('measurement_pending');
      }
      const body = req.body as Record<string, unknown>;
      const unit = body.unit;
      if (unit !== 'as_exported' && unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
        throw new ApiError('validation_failed', { unit: 'Choose as exported, mm, cm or in.' });
      }
      await app.pool.query(
        `UPDATE intake_files SET unit = $2, unit_confirmed = TRUE WHERE id = $1`,
        [record.id, unit],
      );
      const updated = await app.pool.query(`SELECT * FROM intake_files WHERE id = $1`, [record.id]);
      res.json(serializeIntakeFile(updated.rows[0]));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function downloadDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
