import { randomUUID, createHash } from 'node:crypto';
import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from '../shared/domain.js';
import { clinicDate, dueLabel, isIsoDate } from '../shared/clinictime.js';
import { config } from './config.js';
import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid, isMissing } from './errors.js';
import { Ctx, route } from './http.js';
import { publish } from './live.js';
import { notePreview } from './consult.js';
import { exportPdf } from './exports.js';
import { reminderAtCreation } from './reminders.js';
import { getObject, putObject, StorageUnavailable } from './storage.js';
import { readMultipart } from './lib/multipart.js';
import { isId, loadIn, text, whole } from './support.js';

const PATIENT = `
  SELECT p.id, p.clinic_id, p.name, p.species, p.weight_grams, p.photo_file_id, c.name AS client_name,
         CASE WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status = 'in-consult') THEN 'In consult'
              WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status = 'checked-in') THEN 'Waiting'
              WHEN EXISTS (SELECT 1 FROM admissions d JOIN treatments t ON t.admission_id = d.id WHERE d.patient_id = p.id AND t.state = 'open') THEN 'In ward'
         END AS status
    FROM patients p JOIN clients c ON c.id = p.client_id`;

interface PatientRow {
  id: string;
  clinic_id: string;
  name: string;
  species: string;
  weight_grams: number | null;
  photo_file_id: string | null;
  client_name: string;
  status: string | null;
}

const shapePatient = (p: PatientRow) => ({
  id: p.id,
  name: p.name,
  species: p.species,
  clientName: p.client_name,
  weightGrams: p.weight_grams,
  photoFileId: p.photo_file_id,
  status: p.status,
});

const loadPatient = (db: Db, clinicId: string, id: string) => loadIn<PatientRow>(db, `${PATIENT} WHERE p.id = $1 AND p.clinic_id = $2`, id, clinicId);

interface FileRow {
  id: string;
  name: string;
  kind: FileKind;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
}

const shapeFile = (f: FileRow) => ({
  id: f.id,
  name: f.name,
  kind: f.kind,
  contentType: f.content_type,
  sizeBytes: f.size_bytes,
  sha256: f.sha256,
  url: `/api/files/${f.id}/content`,
});

/** File type is judged only by the signature at byte 0. */
function sniff(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const keyName = (name: string) => name.replace(/[/\\\u0000-\u001f\u007f]/g, '_');

/** Stores bytes in MinIO first; the Postgres record exists only after the put is confirmed. */
export async function storeFile(
  db: Db,
  input: { clinicId: string; patientId: string; appointmentId: string | null; name: string; kind: FileKind; bytes: Buffer; contentType: string },
): Promise<FileRow> {
  const id = randomUUID();
  const objectKey = `clinics/${input.clinicId}/patients/${input.patientId}/${id}-${keyName(input.name)}`;
  await putObject(objectKey, input.bytes);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const row = await one<FileRow>(
    db,
    `INSERT INTO files (id, clinic_id, patient_id, appointment_id, name, kind, content_type, size_bytes, sha256, object_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, name, kind, content_type, size_bytes, sha256, object_key`,
    [id, input.clinicId, input.patientId, input.appointmentId, input.name, input.kind, input.contentType, input.bytes.length, sha256, objectKey, now()],
  );
  if (input.kind === 'profile') await db.query('UPDATE patients SET photo_file_id = $2 WHERE id = $1', [input.patientId, id]);
  return row!;
}

interface Upload {
  fields: Record<string, string>;
  file?: { name: string; bytes: Buffer; truncated: boolean };
}

/** The form envelope allowance on top of `UPLOAD_MAX_MB`. */
const ENVELOPE_BYTES = 64 * 1024;

async function readUpload(ctx: Ctx): Promise<Upload> {
  const limit = config.uploadMaxMb * 1_048_576;
  const body = await readMultipart(ctx.req, limit + ENVELOPE_BYTES);
  if (!body) throw invalid('file', 'file', true);
  const file = body.files.file;
  return { fields: body.fields, file: file && { name: file.name, bytes: file.bytes, truncated: file.truncated || file.bytes.length > limit } };
}

async function history(db: Db, patientId: string) {
  const list = await rows<{ id: string; start_at: Date; reason: string; vet_name: string }>(
    db,
    `SELECT a.id, a.start_at, a.reason, v.name AS vet_name FROM appointments a JOIN users v ON v.id = a.vet_id
      WHERE a.patient_id = $1 AND a.status = 'completed' ORDER BY a.start_at DESC`,
    [patientId],
  );
  return Promise.all(
    list.map(async (a) => ({ appointmentId: a.id, start: a.start_at.toISOString(), reason: a.reason, vetName: a.vet_name, notePreview: await notePreview(db, a.id) })),
  );
}

export function registerPatientRoutes(): void {
  route('GET', '/api/patients', async (ctx) => {
    const user = await ctx.user();
    const q = (ctx.query.get('q') ?? '').trim();
    const list = await rows<PatientRow>(
      pool,
      `${PATIENT} WHERE p.clinic_id = $1 AND ($2 = '' OR p.name ILIKE '%' || $3 || '%' OR c.name ILIKE '%' || $3 || '%') ORDER BY p.name, p.id`,
      [user.clinicId, q, q.replace(/[\\%_]/g, (c) => `\\${c}`)],
    );
    ctx.send(200, { patients: list.map(shapePatient) });
  });

  route('GET', '/api/patients/:id', async (ctx) => {
    const user = await ctx.user();
    const patient = await loadPatient(pool, user.clinicId, ctx.params.id);
    const weights = await rows<{ recorded_on: string; grams: number }>(pool, `SELECT to_char(recorded_on, 'YYYY-MM-DD') AS recorded_on, grams FROM weights WHERE patient_id = $1 ORDER BY recorded_on, seq`, [patient.id]);
    const vaccinations = await rows<{ id: string; vaccine: string; due_date: string; reminder: string }>(
      pool,
      `SELECT id, vaccine, to_char(due_date, 'YYYY-MM-DD') AS due_date, reminder FROM vaccinations WHERE patient_id = $1 ORDER BY due_date, vaccine`,
      [patient.id],
    );
    ctx.send(200, {
      ...shapePatient(patient),
      weights: weights.map((w) => ({ recordedOn: w.recorded_on, grams: w.grams })),
      vaccinations: vaccinations.map((v) => ({ id: v.id, vaccine: v.vaccine, dueDate: v.due_date, reminder: v.reminder })),
      history: await history(pool, patient.id),
    });
  });

  route('POST', '/api/patients/:id/weights', async (ctx) => {
    const user = await ctx.user();
    const patient = await loadPatient(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'files.write');
    const body = await ctx.json();
    const grams = whole(body, 'grams', 1, 200_000);
    const recordedOn = clinicDate(now());
    await transaction(user.clinicId, async (db) => {
      await db.query('INSERT INTO weights (patient_id, recorded_on, grams) VALUES ($1, $2, $3)', [patient.id, recordedOn, grams]);
      await db.query('UPDATE patients SET weight_grams = $2 WHERE id = $1', [patient.id, grams]);
      await publish(db, user.clinicId, { t: 'patients' });
    });
    ctx.send(201, { recordedOn, grams });
  });

  route('POST', '/api/patients/:id/vaccinations', async (ctx) => {
    const user = await ctx.user();
    const patient = await loadPatient(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'consult.run');
    const body = await ctx.json();
    const vaccine = text(body, 'vaccine', { max: 80 });
    const dueDate = body.dueDate;
    if (isMissing(dueDate)) throw invalid('dueDate', 'Due date', true);
    if (!isIsoDate(dueDate)) throw invalid('dueDate', 'Due date');
    const reminder = reminderAtCreation(dueDate, now());
    const made = await transaction(user.clinicId, async (db) => {
      const duplicate = await one(db, 'SELECT 1 FROM vaccinations WHERE patient_id = $1 AND vaccine = $2 AND due_date = $3', [patient.id, vaccine, dueDate]);
      if (duplicate) throw new AppError('duplicate_vaccination');
      const row = await one<{ id: string }>(
        db,
        'INSERT INTO vaccinations (patient_id, vaccine, due_date, reminder) VALUES ($1, $2, $3, $4) RETURNING id',
        [patient.id, vaccine, dueDate, reminder],
      );
      await publish(db, user.clinicId, { t: 'patients' });
      return row!;
    });
    ctx.send(201, { id: made.id, vaccine, dueDate, reminder });
  });

  route('POST', '/api/patients/:id/files', async (ctx) => {
    const user = await ctx.user();
    const patient = await loadPatient(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'files.write');
    const upload = await readUpload(ctx);
    const kind = upload.fields.kind;
    if (kind === undefined || kind === '') throw invalid('kind', 'kind', true);
    if (!FILE_KINDS.includes(kind as FileKind)) throw invalid('kind', 'kind');
    let appointmentId: string | null = null;
    if (upload.fields.appointmentId) {
      const found = isId(upload.fields.appointmentId)
        ? await one<{ id: string }>(pool, 'SELECT id FROM appointments WHERE id = $1 AND clinic_id = $2 AND patient_id = $3', [upload.fields.appointmentId, user.clinicId, patient.id])
        : undefined;
      if (!found) throw new AppError('not_found');
      appointmentId = found.id;
    }
    if (!upload.file) throw invalid('file', 'file', true);
    const nameBytes = Buffer.byteLength(upload.file.name, 'utf8');
    if (nameBytes === 0 || nameBytes > 255) throw invalid('file', 'file');
    if (upload.file.truncated) throw new AppError('file_too_large', `That file is larger than ${config.uploadMaxMb} MB.`, 'file');
    const contentType = sniff(upload.file.bytes);
    if (!contentType) throw new AppError('unsupported_type', undefined, 'file');
    let stored: FileRow;
    try {
      stored = await storeFile(pool, { clinicId: user.clinicId, patientId: patient.id, appointmentId, name: upload.file.name, kind: kind as FileKind, bytes: upload.file.bytes, contentType });
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new AppError('storage_unavailable', 'File storage is unavailable. Your file was not saved.');
      throw error;
    }
    await publish(pool, user.clinicId, { t: 'patients' });
    ctx.send(201, shapeFile(stored));
  });

  route('GET', '/api/patients/:id/files', async (ctx) => {
    const user = await ctx.user();
    const patient = await loadPatient(pool, user.clinicId, ctx.params.id);
    const list = await rows<FileRow>(pool, 'SELECT id, name, kind, content_type, size_bytes, sha256, object_key FROM files WHERE patient_id = $1 ORDER BY seq', [patient.id]);
    ctx.send(200, { files: list.map(shapeFile) });
  });

  route('GET', '/api/files/:id/content', async (ctx) => {
    const user = await ctx.user();
    const file = await loadIn<FileRow>(pool, 'SELECT id, name, kind, content_type, size_bytes, sha256, object_key FROM files WHERE id = $1 AND clinic_id = $2', ctx.params.id, user.clinicId);
    let bytes: Buffer;
    try {
      bytes = await getObject(file.object_key);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new AppError('storage_unavailable');
      throw error;
    }
    const encoded = [...Buffer.from(file.name, 'utf8')].map((b) => (/[A-Za-z0-9_.~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
    ctx.res.writeHead(200, {
      'Content-Type': file.content_type,
      'Content-Length': bytes.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'private, max-age=60',
    });
    ctx.res.end(bytes);
  });

  route('GET', '/api/patients/:id/history.pdf', async (ctx) => {
    const user = await ctx.user();
    const patient = await loadPatient(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'consult.run');
    const lines = (await history(pool, patient.id)).map((h) => `${dueLabel(clinicDate(new Date(h.start)))} ${h.reason} with ${h.vetName}`);
    if (ctx.query.get('include') === 'files') {
      const files = await rows<FileRow>(pool, 'SELECT id, name, kind, content_type, size_bytes, sha256, object_key FROM files WHERE patient_id = $1 ORDER BY seq', [patient.id]);
      lines.push(...files.map((f) => `File: ${f.name} (${FILE_KIND_LABEL[f.kind]})`));
    }
    await exportPdf(ctx, user.clinicId, `history-${patient.id}`, { heading: `Patient: ${patient.name}`, body: lines, closing: [], created: now() });
  });
}
