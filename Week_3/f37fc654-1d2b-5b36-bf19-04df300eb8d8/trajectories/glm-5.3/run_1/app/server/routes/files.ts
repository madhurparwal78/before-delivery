import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import { enqueueJob } from '../jobs.js';
import { ObjectStore } from '../services/objectstore.js';
import { fetchReferenceImage } from '../domain/ssrf.js';

const FILE_LIMITS = {
  brief_pdf: { limitBytes: 10_485_760, kindLabel: 'brief PDF' },
  venue_photo: { limitBytes: 12_582_912, kindLabel: 'venue photo' },
  installation_glb: { limitBytes: 26_214_400, kindLabel: 'GLB model' },
} as const;

type FileKind = keyof typeof FILE_LIMITS;

export function filesRendersRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);
  const store = new ObjectStore(cfg);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 26_214_400 + 65_536 } });

  async function visibleCommission(tx: svc.DbClientAlias, req: AuthedRequest, id: string): Promise<svc.CommissionRow> {
    const user = req.user;
    if (!user) throw new HttpError(401, 'unauthenticated', '');
    const commission = await svc.getCommission(tx, id);
    if (!commission) throw new HttpError(404, 'not_found', '');
    if (user.role !== 'producer' && commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
    return commission;
  }

  // ---------- Files ----------

  router.post('/commissions/:id/files', auth, upload.single('file'), async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const uploaded = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
      const kind = (req.body as { kind?: string })['kind'];
      if (!kind || !(kind in FILE_LIMITS)) {
        res.status(422).json({ errors: { kind: 'Pick brief_pdf, venue_photo or installation_glb.' } });
        return;
      }
      const fileKind = kind as FileKind;
      const meta = FILE_LIMITS[fileKind];
      const fileName = cleanFileName(uploaded?.originalname ?? 'file');
      const bytes = uploaded?.buffer ?? Buffer.alloc(0);
      if (bytes.length > meta.limitBytes) {
        res.status(413).json({
          error: { code: 'file_too_large', message: `${fileName} is over the ${meta.limitBytes}-byte limit for a ${meta.kindLabel}.`, limitBytes: meta.limitBytes },
        });
        return;
      }
      const check = contentCheck(fileKind, bytes);
      if (!check) {
        res.status(422).json({ errors: { file: `${fileName} isn't a ${meta.kindLabel}.` } });
        return;
      }
      // A file is Stored only after MinIO acknowledges the write and the app confirms the size.
      const up = await store.available();
      if (!up) {
        res.status(503).json({ error: { code: 'storage_unavailable', message: "Uploads are paused — our file store isn't answering. Nothing was saved." } });
        return;
      }
      const sha = crypto.createHash('sha256').update(bytes).digest('hex');
      const fileContentType = contentTypeFor(fileKind, bytes);
      const fileId = crypto.randomUUID();
      await store.put(`commissions/${id}/files/${fileId}`, bytes, fileContentType);
      const createdAt = await withTransaction(async (tx) => {
        await visibleCommission(tx, req as AuthedRequest, id);
        const fileRow = await tx.query(
          `INSERT INTO commission_files (id, commission_id, kind, file_name, content_type, size_bytes, sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at`,
          [fileId, id, fileKind, fileName, fileContentType, bytes.length, sha],
        );
        return (fileRow.rows[0] as { created_at: Date }).created_at;
      });
      res.status(201).json({
        id: fileId,
        kind: fileKind,
        fileName,
        contentType: fileContentType,
        sizeBytes: bytes.length,
        sha256: sha,
        status: 'stored',
        createdAt: createdAt.toISOString(),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/commissions/:id/files', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        await visibleCommission(tx, req as AuthedRequest, id);
        const rows = await tx.query(`SELECT * FROM commission_files WHERE commission_id = $1 ORDER BY created_at`, [id]);
        res.json({
          files: rows.rows.map((r: { id: string; kind: string; file_name: string; content_type: string; size_bytes: number; sha256: string; created_at: Date }) => ({
            id: r.id,
            kind: r.kind,
            fileName: r.file_name,
            contentType: r.content_type,
            sizeBytes: Number(r.size_bytes),
            sha256: r.sha256,
            status: 'stored',
            createdAt: r.created_at.toISOString(),
          })),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/files/:fileId/content', auth, async (req, res, next) => {
    try {
      const fileId = (req.params as { fileId?: string })['fileId'] ?? '';
      const tx = await pool.connect();
      let commissionId = '';
      let contentType = 'application/octet-stream';
      try {
        const row = (await tx.query(`SELECT commission_id, content_type FROM commission_files WHERE id = $1`, [fileId])).rows[0] as { commission_id: string; content_type: string } | undefined;
        if (!row) {
          res.status(404).json({ error: { code: 'not_found' } });
          return;
        }
        await visibleCommission(tx, req as AuthedRequest, row.commission_id);
        commissionId = row.commission_id;
        contentType = row.content_type;
      } finally {
        tx.release();
      }
      const object = await store.get(`commissions/${commissionId}/files/${fileId}`);
      if (!object) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      res.setHeader('content-type', contentType);
      res.send(object.bytes);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Renders ----------

  router.post('/commissions/:id/renders', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const body = req.body as { venuePhotoFileId?: string; referenceImageUrl?: string };
      const tx = await pool.connect();
      try {
        const commission = await visibleCommission(tx, req as AuthedRequest, id);
        if (!body.venuePhotoFileId) throw new HttpError(404, 'not_found', '');
        // The file must be a stored venue photo of this commission, whatever the state.
        const photo = (await tx.query(
          `SELECT id FROM commission_files WHERE id = $1 AND commission_id = $2 AND kind = 'venue_photo'`,
          [body.venuePhotoFileId, id],
        )).rows[0] as { id: string } | undefined;
        if (!photo) throw new HttpError(404, 'not_found', '');
        if (!['briefed', 'previewed', 'placed'].includes(commission.state)) throw new HttpError(409, 'illegal_state', '');
      } finally {
        tx.release();
      }
      // The reference image is fetched and re-checked at every hop.
      if (typeof body.referenceImageUrl === 'string' && body.referenceImageUrl !== '') {
        const fetchResult = await fetchReferenceImage(body.referenceImageUrl);
        if (!fetchResult.ok) {
          const refused = fetchResult.refused === true;
          throw new HttpError(422, 'validation', '', {
            errors: { referenceImageUrl: refused ? "That address can't be used for a reference image." : "We couldn't fetch an image from that address." },
          });
        }
        const imgBytes = fetchResult.bytes ?? Buffer.alloc(0);
        const isImage = imgBytes.length > 0 && (imgBytes[0] === 0xff || imgBytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');
        if (!isImage) {
          throw new HttpError(422, 'validation', '', { errors: { referenceImageUrl: "We couldn't fetch an image from that address." } });
        }
      }
      const renderId = await withTransaction(async (tx) => {
        const rid = crypto.randomUUID();
        await tx.query(
          `INSERT INTO renders (id, commission_id, venue_photo_file_id, reference_source_url, state, progress)
           VALUES ($1, $2, $3, $4, 'queued', 0)`,
          [rid, id, body.venuePhotoFileId, body.referenceImageUrl ?? null],
        );
        await enqueueJob(tx, 'render_submit', id, { renderId: rid }, `render-submit-${rid}`);
        return rid;
      });
      res.status(202).json({ id: renderId, commissionId: id, state: 'queued', progress: 0, createdAt: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  });

  router.get('/renders/:renderId', auth, async (req, res, next) => {
    try {
      const renderId = (req.params as { renderId?: string })['renderId'] ?? '';
      const tx = await pool.connect();
      try {
        const row = (await tx.query(`SELECT * FROM renders WHERE id = $1`, [renderId])).rows[0] as
          | { id: string; commission_id: string; state: string; progress: number; provider_job_id: string | null; failure_reason: string | null; preview_sha256: string | null }
          | undefined;
        if (!row) {
          res.status(404).json({ error: { code: 'not_found' } });
          return;
        }
        const commission = await svc.getCommission(tx, row.commission_id);
        const user = (req as AuthedRequest).user!;
        if (!commission || (user.role !== 'producer' && commission.client_id !== user.id)) {
          res.status(404).json({ error: { code: 'not_found' } });
          return;
        }
        res.json({
          id: row.id,
          state: row.state,
          progress: row.progress,
          providerJobId: row.provider_job_id,
          failureReason: row.failure_reason,
          previewSha256: row.preview_sha256,
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/renders/:renderId/preview', auth, async (req, res, next) => {
    try {
      const renderId = (req.params as { renderId?: string })['renderId'] ?? '';
      const tx = await pool.connect();
      let commissionId = '';
      try {
        const row = (await tx.query(`SELECT commission_id, state FROM renders WHERE id = $1`, [renderId])).rows[0] as { commission_id: string; state: string } | undefined;
        if (!row) {
          res.status(404).json({ error: { code: 'not_found' } });
          return;
        }
        const commission = await svc.getCommission(tx, row.commission_id);
        const user = (req as AuthedRequest).user!;
        if (!commission || (user.role !== 'producer' && commission.client_id !== user.id)) {
          res.status(404).json({ error: { code: 'not_found' } });
          return;
        }
        if (row.state !== 'ready') {
          res.status(409).json({ error: { code: 'not_ready' } });
          return;
        }
        commissionId = row.commission_id;
      } finally {
        tx.release();
      }
      const object = await store.get(`commissions/${commissionId}/renders/${renderId}.png`);
      if (!object) {
        res.status(409).json({ error: { code: 'not_ready' } });
        return;
      }
      res.setHeader('content-type', 'image/png');
      res.send(object.bytes);
    } catch (e) {
      next(e);
    }
  });

  router.get('/commissions/:id/renders', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        await visibleCommission(tx, req as AuthedRequest, id);
        const rows = await tx.query(`SELECT * FROM renders WHERE commission_id = $1 ORDER BY created_at DESC`, [id]);
        res.json({
          renders: rows.rows.map((r: { id: string; state: string; progress: number; created_at: Date }) => ({
            id: r.id,
            state: r.state,
            progress: r.progress,
            createdAt: r.created_at.toISOString(),
          })),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  return router;
}

function cleanFileName(name: string): string {
  const last = name.split('/').pop() ?? 'file';
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.slice(0, 120) || 'file';
}

function contentCheck(kind: FileKind, bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  if (kind === 'brief_pdf') return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (kind === 'venue_photo') {
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    return jpeg || png;
  }
  if (bytes.length < 12) return false;
  const magic = bytes.subarray(0, 4).toString('latin1') === 'glTF';
  const version = bytes.readUInt32LE(4);
  const length = bytes.readUInt32LE(8);
  return magic && version === 2 && length === bytes.length;
}

function contentTypeFor(kind: FileKind, bytes: Buffer): string {
  if (kind === 'brief_pdf') return 'application/pdf';
  if (kind === 'installation_glb') return 'model/gltf-binary';
  if (bytes[0] === 0xff) return 'image/jpeg';
  return 'image/png';
}
