import express from 'express';
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import { putObject } from '../s3.js';

export const router = express.Router();

const KINDS = ['xray', 'wound', 'lab', 'consent', 'profile'];
const KIND_LABELS: Record<string, string> = {
  xray: 'X-ray',
  wound: 'Wound photo',
  lab: 'Lab report',
  consent: 'Consent form',
  profile: 'Profile photo',
};

// The type of an upload is judged only by its bytes at offset 0.
export function sniffType(buf: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const UPLOAD_LIMIT = settings.uploadMaxMb * 1048576;

router.post('/patients/:id/files', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['vet', 'nurse', 'manager']);
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!patient) throw t('not_found');
  // multipart parsing is done in the multipart middleware (server.js)
  const ctx = (req as any).upload;
  if (!ctx || !ctx.file) throw validationError('file');
  const { file, kind } = ctx;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw notValid('kind');
  const name = file.name;
  if (typeof name !== 'string' || name.length === 0 || Buffer.byteLength(name, 'utf8') > 255) {
    throw validationError('file');
  }
  if (file.size > UPLOAD_LIMIT) {
    throw t('file_too_large', { UPLOAD_MAX_MB: settings.uploadMaxMb, field: 'file' });
  }
  const sniffed = sniffType(file.buffer);
  if (!sniffed) throw t('unsupported_type', { field: 'file' });
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const id = crypto.randomUUID();
  const safeName = name.replace(/[\/\\]/g, '_').replace(/[\x00-\x1f]/g, '_');
  const key = `/clinics/${user.clinicId}/patients/${req.params.id}/${id}-${safeName}`;
  try {
    await putObject(key, file.buffer);
  } catch {
    // the upload copy names the file that was not saved
    throw t('storage_unavailable_upload', { field: 'file' });
  }
  const appointmentId = ctx.appointmentId ?? null;
  await q(
    `insert into patient_files (id, clinic_id, patient_id, appointment_id, name, kind, content_type, size_bytes, sha256, s3_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, user.clinicId, req.params.id, appointmentId, name, kind, sniffed, file.buffer.length, sha256, key]
  );
  if (kind === 'profile') {
    await q(`update patients set photo_file_id = $1 where id = $2`, [id, req.params.id]);
  }
  bus.pushClinic(user.clinicId, 'files', { patientId: req.params.id });
  return {
    status: 201,
    body: {
      id,
      name,
      kind,
      contentType: sniffed,
      sizeBytes: file.buffer.length,
      sha256,
      url: `/api/files/${id}/content`,
    },
  };
}));

router.get('/patients/:id/files', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!patient) throw t('not_found');
  const r = await q(
    `select * from patient_files where patient_id = $1 order by created_at`,
    [req.params.id]
  );
  return {
    status: 200,
    body: {
      files: r.rows.map((f: any) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        contentType: f.content_type,
        sizeBytes: Number(f.size_bytes),
        sha256: f.sha256,
        url: `/api/files/${f.id}/content`,
      })),
    },
  };
}));

export { KIND_LABELS };

router.get('/files/:id/content', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const row = await one(
    `select * from patient_files where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!row) throw t('not_found');
  const { getObject } = await import('../s3.js');
  const buffer = await getObject(row.s3_key);
  const encoded = encodeURIComponent(row.name);
  res.setHeader('Content-Type', row.content_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
  res.status(200).send(buffer);
  return null;
}));

export default router;
