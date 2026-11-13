import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, raw } from 'express';
import { env } from '../env.js';
import { query, withTransaction } from '../db/pool.js';
import { ApiError, ValidationError, illegalState, notFound } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller } from '../http/session.js';
import { commissionFor, renderFor } from '../domain/access.js';
import { enqueue } from '../jobs/queue.js';
import { publishNow } from '../jobs/events.js';
import {
  AddressRefused,
  FetchFailed,
  fetchReferenceImage,
} from '../domain/safe-fetch.js';
import { getObject } from '../services/s3.js';
import { REFERENCE_FETCH_FAILED, REFERENCE_REFUSED } from '../../shared/copy.js';
import { RENDER_REQUEST_STATES } from '../../shared/states.js';
import { isoUtc } from '../../shared/venue-time.js';

export const rendersRouter = Router();

const CALLBACK_BODY_LIMIT = 16_777_216;
const TIMESTAMP_TOLERANCE_SECONDS = 300;

rendersRouter.post(
  '/api/commissions/:commissionId/renders',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    if (!RENDER_REQUEST_STATES.includes(commission.state)) throw illegalState();

    const body = bodyObject(req);
    const venuePhotoFileId = String(body['venuePhotoFileId'] ?? '');
    const photo = await query<{ id: string }>(
      `SELECT id FROM files
        WHERE id = $1 AND commission_id = $2 AND kind = 'venue_photo' AND status = 'stored'`,
      [venuePhotoFileId.length === 36 ? venuePhotoFileId : randomUUID(), commission.id],
    );
    if (!photo.rows[0]) throw notFound();

    const rawReference = body['referenceImageUrl'];
    let referenceImage: Record<string, unknown> | null = null;
    let referenceUrl: string | null = null;
    if (typeof rawReference === 'string' && rawReference.trim() !== '') {
      referenceUrl = rawReference.trim();
      try {
        const fetched = await fetchReferenceImage(referenceUrl);
        referenceImage = {
          sourceUrl: fetched.sourceUrl,
          contentType: fetched.contentType,
          sha256: fetched.sha256,
          base64: fetched.bytes.toString('base64'),
        };
      } catch (error) {
        if (error instanceof AddressRefused) {
          throw new ValidationError({ referenceImageUrl: REFERENCE_REFUSED });
        }
        if (error instanceof FetchFailed) {
          throw new ValidationError({ referenceImageUrl: REFERENCE_FETCH_FAILED });
        }
        throw error;
      }
    }

    const renderId = randomUUID();
    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO renders
           (id, commission_id, venue_photo_file_id, reference_image_url, reference_image, state, progress)
         VALUES ($1, $2, $3, $4, $5, 'queued', 0)`,
        [
          renderId,
          commission.id,
          venuePhotoFileId,
          referenceUrl,
          referenceImage === null ? null : JSON.stringify(referenceImage),
        ],
      );
      await enqueue(tx, {
        kind: 'render_submit',
        commissionId: commission.id,
        dedupeKey: `render_submit:${renderId}`,
        payload: { renderId },
      });
    });

    res.status(202).json({
      id: renderId,
      commissionId: commission.id,
      state: 'queued',
      progress: 0,
      createdAt: isoUtc(new Date()),
    });
  }),
);

rendersRouter.get(
  '/api/renders/:renderId',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const render = await renderFor(pathParam(req, 'renderId'), caller);
    res.json({
      id: render.id,
      commissionId: render.commission_id,
      state: render.state,
      progress: render.progress,
      providerJobId: render.provider_job_id,
      failureReason: render.failure_reason,
      previewSha256: render.preview_sha256,
    });
  }),
);

rendersRouter.get(
  '/api/renders/:renderId/preview',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const render = await renderFor(pathParam(req, 'renderId'), caller);
    if (render.state !== 'ready' || !render.preview_object_key) {
      throw new ApiError(409, 'not_ready');
    }
    const object = await getObject(render.preview_object_key);
    res.type('image/png').send(object.bytes);
  }),
);

interface CallbackBody {
  eventId?: unknown;
  jobRef?: unknown;
  providerJobId?: unknown;
  type?: unknown;
  progress?: unknown;
  preview?: { contentType?: unknown; base64?: unknown };
  failureReason?: unknown;
}

function signatureMatches(rawBody: Buffer, timestamp: string, provided: string): boolean {
  const expected = `v1=${createHmac('sha256', env.renderWebhookSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  );
}

/**
 * Render callbacks. A callback is accepted only with a valid signature and a
 * fresh timestamp; each event id takes effect once, progress never goes down,
 * and the first terminal callback wins.
 */
rendersRouter.post(
  '/api/render-callbacks',
  raw({ type: '*/*', limit: CALLBACK_BODY_LIMIT }),
  route(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const timestamp = req.header('x-render-timestamp') ?? '';
    const signature = req.header('x-render-signature') ?? '';

    if (!signatureMatches(rawBody, timestamp, signature)) {
      throw new ApiError(401, 'bad_signature');
    }
    const seconds = Number.parseInt(timestamp, 10);
    if (
      !Number.isFinite(seconds) ||
      Math.abs(Date.now() / 1000 - seconds) > TIMESTAMP_TOLERANCE_SECONDS
    ) {
      throw new ApiError(401, 'stale_timestamp');
    }

    let body: CallbackBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as CallbackBody;
    } catch {
      throw new ValidationError({ body: 'Send a JSON callback.' });
    }

    const jobRef = String(body.jobRef ?? '');
    const eventId = String(body.eventId ?? '');
    const renderResult = await query<{
      id: string;
      commission_id: string;
      state: string;
      progress: number;
    }>('SELECT id, commission_id, state, progress FROM renders WHERE id = $1', [
      jobRef.length === 36 ? jobRef : randomUUID(),
    ]);
    const render = renderResult.rows[0];
    if (!render) throw notFound();

    const type = String(body.type ?? '');
    if (type === 'render.completed') {
      const base64 = String(body.preview?.base64 ?? '');
      const bytes = Buffer.from(base64, 'base64');
      if (String(body.preview?.contentType ?? '') !== 'image/png' || !isPng(bytes)) {
        throw new ValidationError({ preview: 'Preview must be a PNG image.' });
      }
    }

    // Each event id takes effect once, even when the same event arrives twice.
    const claimed = await query<{ event_id: string }>(
      `INSERT INTO render_callback_events (event_id, render_id)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId === '' ? randomUUID() : eventId, render.id],
    );
    if (!claimed.rows[0]) {
      res.status(204).end();
      return;
    }

    // Anything arriving after a terminal callback changes nothing.
    if (render.state === 'ready' || render.state === 'failed') {
      res.status(204).end();
      return;
    }

    const progress = Number(body.progress ?? 0);
    const nextProgress = Number.isFinite(progress)
      ? Math.max(render.progress, Math.min(100, Math.round(progress)))
      : render.progress;

    if (type === 'render.failed') {
      await query(
        `UPDATE renders SET state = 'failed', failure_reason = $2, progress = $3 WHERE id = $1`,
        [render.id, String(body.failureReason ?? 'provider_failed'), nextProgress],
      );
      await announceRender(render.id, render.commission_id, 'failed', nextProgress);
      res.status(204).end();
      return;
    }

    if (type === 'render.completed') {
      await withTransaction(async (tx) => {
        await tx.query(
          `UPDATE renders SET state = 'callback_verified', progress = $2 WHERE id = $1`,
          [render.id, nextProgress],
        );
        await enqueue(tx, {
          kind: 'render_store',
          commissionId: render.commission_id,
          dedupeKey: `render_store:${render.id}`,
          payload: { renderId: render.id, previewBase64: String(body.preview?.base64 ?? '') },
        });
      });
      await announceRender(render.id, render.commission_id, 'callback_verified', nextProgress);
      res.status(204).end();
      return;
    }

    await query(
      `UPDATE renders
          SET state = CASE WHEN state = 'submitted' THEN 'callback_verified' ELSE state END,
              progress = $2
        WHERE id = $1`,
      [render.id, nextProgress],
    );
    const updated = await query<{ state: string }>('SELECT state FROM renders WHERE id = $1', [
      render.id,
    ]);
    await announceRender(
      render.id,
      render.commission_id,
      updated.rows[0]?.state ?? 'callback_verified',
      nextProgress,
    );
    res.status(204).end();
  }),
);

async function announceRender(
  renderId: string,
  commissionId: string,
  state: string,
  progress: number,
): Promise<void> {
  const result = await query<{ client_id: string }>(
    'SELECT client_id FROM commissions WHERE id = $1',
    [commissionId],
  );
  const clientId = result.rows[0]?.client_id;
  await publishNow({
    type: 'render.updated',
    renderId,
    commissionId,
    state,
    progress,
    audience: clientId ? [clientId, 'producer'] : ['producer'],
  });
}
