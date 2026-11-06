import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { emitItem, jobWrite } from '../events.js';
import {
  parseMultipart,
  requireAccount,
  route,
  sendBytes,
  sendEmpty,
  sendJson,
  type Ctx,
  type Route,
} from '../http.js';
import { requireJob, requireOpenJob, requireUuid } from '../jobctx.js';
import { intakeImage } from '../imageintake.js';
import { canSeeItem, loadItems, projectPhoto, type PhotoRecord } from '../model.js';
import { reloadItem, requireItem } from '../itemcore.js';
import {
  deleteObject,
  getObject,
  objectExists,
  putObject,
  StorageUnavailable,
} from '../services/objectstore.js';

async function findPhoto(jobId: string, photoId: string): Promise<PhotoRecord | null> {
  requireUuid(photoId);
  const { rows } = await db.query(
    `select item_id from photos where job_id = $1 and id = $2`,
    [jobId, photoId],
  );
  if (rows.length === 0) return null;
  const items = await loadItems(db, jobId, [rows[0].item_id as string]);
  return items[0].photos.find((photo) => photo.id === photoId) ?? null;
}

export const photoRoutes: Route[] = [
  route('POST', '/api/jobs/:jobId/items/:itemId/photos', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const parts = parseMultipart(ctx.rawBody!, ctx.req.headers['content-type'] ?? '');
    const kindPart = parts.find((part) => part.name === 'kind');
    const kind = kindPart?.data.toString('utf8').trim();
    const role = jobCtx.viewer.role;
    if (role === 'homeowner') fail('forbidden');
    if (kind === 'defect' && role !== 'owner' && role !== 'lead') fail('forbidden');
    if (
      kind === 'completion' &&
      role === 'trade' &&
      (item.trade === null || item.trade !== jobCtx.viewer.trade)
    ) {
      fail('forbidden');
    }
    if (role === 'trade' && kind !== 'completion') fail('forbidden');
    requireOpenJob(jobCtx);
    if (kind !== 'defect' && kind !== 'completion') {
      throw new ApiError('validation', { fields: { kind: 'Choose defect or completion.' } });
    }
    const filePart = parts.find((part) => part.name === 'file');
    if (filePart === undefined) {
      throw new ApiError('validation', { fields: { file: 'Choose an image.' } });
    }
    const image = intakeImage(filePart);

    const photoId = randomUUID();
    const key = `jobs/${jobCtx.job.id}/items/${item.id}/photos/${photoId}.${image.extension}`;
    try {
      await putObject(key, image.data, image.contentType);
      if (!(await objectExists(key))) fail('storage_unavailable');
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }

    const photo = await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(
        `insert into photos (id, job_id, item_id, kind, content_type, bytes, object_key, uploaded_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [
          photoId,
          jobCtx.job.id,
          item.id,
          kind,
          image.contentType,
          image.bytes,
          key,
          jobCtx.viewer.personId,
        ],
      );
      const fresh = await reloadItem(tx, jobCtx.job.id, item.id);
      await emitItem(tx, jobCtx.job.id, fresh, fresh.trade);
      return fresh.photos.find((candidate) => candidate.id === photoId)!;
    });
    sendJson(ctx.res, 201, projectPhoto(photo));
  }),

  route('GET', '/api/jobs/:jobId/photos/:photoId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const photo = await findPhoto(jobCtx.job.id, ctx.params.photoId);
    if (photo === null) fail('not_found');
    const items = await loadItems(db, jobCtx.job.id, [photo.itemId]);
    if (!canSeeItem(jobCtx.viewer, items[0])) fail('not_found');
    let bytes: Buffer | null;
    try {
      bytes = await getObject(photo.objectKey);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
    if (bytes === null) fail('storage_unavailable');
    sendBytes(ctx.res, 200, bytes, photo.contentType, 'no-store');
  }),

  route('DELETE', '/api/jobs/:jobId/photos/:photoId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const photo = await findPhoto(jobCtx.job.id, ctx.params.photoId);
    if (photo === null) fail('not_found');
    const items = await loadItems(db, jobCtx.job.id, [photo.itemId]);
    if (!canSeeItem(jobCtx.viewer, items[0])) fail('not_found');
    const { rows } = await db.query(`select uploaded_by from photos where id = $1`, [photo.id]);
    const uploader = rows[0].uploaded_by as string;
    const role = jobCtx.viewer.role;
    if (role !== 'owner' && role !== 'lead' && uploader !== jobCtx.viewer.personId) {
      fail('forbidden');
    }
    requireOpenJob(jobCtx);
    try {
      await deleteObject(photo.objectKey);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(`delete from photos where id = $1`, [photo.id]);
      const fresh = await reloadItem(tx, jobCtx.job.id, photo.itemId);
      await emitItem(tx, jobCtx.job.id, fresh, fresh.trade);
    });
    sendEmpty(ctx.res, 204);
  }),
];
