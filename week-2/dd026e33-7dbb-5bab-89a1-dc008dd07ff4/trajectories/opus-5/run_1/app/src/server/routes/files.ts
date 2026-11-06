import { createHash, randomUUID } from 'node:crypto';
import { query } from '../db';
import { VALIDATION_MESSAGES, fail } from '../http/errors';
import type { MultipartReader } from '../http/body';
import type { Route } from '../http/pipeline';
import { getObject, putObject } from '../providers/s3';
import { loadCarRow, toPhoto, toReport, type PhotoRow, type ReportRow } from '../domain/cars';
import { ownerScope } from './cars';

const PDF_MAGIC = Buffer.from('%PDF-');
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface UploadedFile {
  readonly bytes: Buffer;
  readonly contentType: string;
}

/** Reads the plain fields that come before the file part. */
async function readFieldsBeforeFile(
  reader: MultipartReader,
): Promise<{ fields: Map<string, string>; filePart: boolean }> {
  const fields = new Map<string, string>();
  for (;;) {
    const part = await reader.nextPart();
    if (part === null) return { fields, filePart: false };
    if (part.name === 'file') return { fields, filePart: true };
    fields.set(part.name, (await reader.readPart()).toString('utf8').trim());
  }
}

async function readFile(reader: MultipartReader): Promise<UploadedFile> {
  const bytes = await reader.readPart();
  return { bytes, contentType: 'application/octet-stream' };
}

export const fileRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/cars/:id/condition-report',
    body: 'upload',
    session: 'required',
    async handle(ctx) {
      const carId = ctx.params.id ?? '';
      const car = await loadCarRow(carId, ownerScope(ctx));
      if (car === null) throw fail.notFound();
      ctx.requireRole('concierge', 'house_manager');
      const reader = ctx.multipart;
      if (reader === null) throw fail.unsupportedMediaType();

      // The stay is claimed before any file body is read.
      const reportId = randomUUID();
      const claimed = await query<{ id: string }>(
        `insert into condition_reports (id, car_id, stay_seq, claimed_at)
         values ($1,$2,$3,now())
         on conflict (car_id, stay_seq) do nothing
         returning id`,
        [reportId, carId, car.stay_seq],
      );
      if (claimed.length === 0) throw fail.conflict('report_already_signed');

      try {
        const { filePart } = await readFieldsBeforeFile(reader);
        if (!filePart) throw fail.validation({ file: VALIDATION_MESSAGES.reportFile });
        const file = await readFile(reader);
        if (!file.bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
          throw fail.validation({ file: VALIDATION_MESSAGES.reportFile });
        }
        const objectKey = `cars/${carId}/condition-reports/${reportId}.pdf`;
        await putObject(objectKey, file.bytes, 'application/pdf');
        const sha256 = createHash('sha256').update(file.bytes).digest('hex');
        await query(
          `update condition_reports set completed = true, sha256 = $2, size_bytes = $3,
             object_key = $4, uploaded_at = $5, uploaded_by = $6
           where id = $1`,
          [reportId, sha256, file.bytes.length, objectKey, ctx.now, ctx.user().id],
        );
        const stored = await query<ReportRow>(
          `select r.*, u.name as uploaded_by_name from condition_reports r
           join users u on u.id = r.uploaded_by where r.id = $1`,
          [reportId],
        );
        const report = stored[0];
        if (report === undefined) throw fail.notFound();
        return { kind: 'json', status: 201, body: { report: toReport(report) } };
      } catch (error) {
        await query('delete from condition_reports where id = $1 and completed = false', [reportId]);
        throw error;
      }
    },
  },
  {
    method: 'GET',
    pattern: '/api/condition-reports/:id/file',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const owner = ownerScope(ctx);
      const rows = await query<{ object_key: string }>(
        `select r.object_key from condition_reports r
         join cars c on c.id = r.car_id
         where r.id = $1 and r.completed = true ${owner === null ? '' : 'and c.owner_id = $2'}`,
        owner === null ? [ctx.params.id ?? ''] : [ctx.params.id ?? '', owner],
      );
      const found = rows[0];
      if (found === undefined) throw fail.notFound();
      const object = await getObject(found.object_key);
      return {
        kind: 'bytes',
        status: 200,
        body: object.body,
        contentType: 'application/pdf',
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/cars/:id/photos',
    body: 'upload',
    session: 'required',
    async handle(ctx) {
      const carId = ctx.params.id ?? '';
      const car = await loadCarRow(carId, ownerScope(ctx));
      if (car === null) throw fail.notFound();
      const reader = ctx.multipart;
      if (reader === null) throw fail.unsupportedMediaType();

      const { fields, filePart } = await readFieldsBeforeFile(reader);
      const kind = fields.get('kind') === 'stage' ? 'stage' : 'intake';
      let jobId: string | null = null;
      if (kind === 'stage') {
        const requested = fields.get('job_id') ?? '';
        const job = await query<{ id: string }>(
          'select id from jobs where id = $1 and car_id = $2',
          [requested, carId],
        );
        if (job[0] === undefined) throw fail.notFound();
        jobId = job[0].id;
        ctx.requireRole('workshop_lead', 'house_manager');
      } else {
        ctx.requireRole('concierge', 'house_manager');
      }
      if (!filePart) throw fail.validation({ file: VALIDATION_MESSAGES.photoFile });

      const file = await readFile(reader);
      const isJpeg = file.bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
      const isPng = file.bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
      if (!isJpeg && !isPng) throw fail.validation({ file: VALIDATION_MESSAGES.photoFile });

      const photoId = randomUUID();
      const contentType = isJpeg ? 'image/jpeg' : 'image/png';
      const objectKey = `cars/${carId}/photos/${photoId}.${isJpeg ? 'jpg' : 'png'}`;
      await putObject(objectKey, file.bytes, contentType);
      await query(
        `insert into photos (id, car_id, kind, job_id, content_type, size_bytes, object_key, created_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          photoId,
          carId,
          kind,
          jobId,
          contentType,
          file.bytes.length,
          objectKey,
          ctx.now,
          ctx.user().id,
        ],
      );
      const stored = await query<PhotoRow>('select * from photos where id = $1', [photoId]);
      const photo = stored[0];
      if (photo === undefined) throw fail.notFound();
      return { kind: 'json', status: 201, body: { photo: toPhoto(photo) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/photos/:id/content',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const owner = ownerScope(ctx);
      const rows = await query<{ object_key: string; content_type: string }>(
        `select p.object_key, p.content_type from photos p
         join cars c on c.id = p.car_id
         where p.id = $1 ${owner === null ? '' : 'and c.owner_id = $2'}`,
        owner === null ? [ctx.params.id ?? ''] : [ctx.params.id ?? '', owner],
      );
      const found = rows[0];
      if (found === undefined) throw fail.notFound();
      const object = await getObject(found.object_key);
      return {
        kind: 'bytes',
        status: 200,
        body: object.body,
        contentType: found.content_type,
      };
    },
  },
];
