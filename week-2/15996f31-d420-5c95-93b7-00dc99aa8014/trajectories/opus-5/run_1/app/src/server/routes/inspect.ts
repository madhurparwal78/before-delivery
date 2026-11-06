import { formatTenths } from '../../shared/format';
import { orderStatusLabel } from '../../shared/labels';
import { pool, withTransaction } from '../db';
import { loadOrder } from '../data/order-access';
import { issueFileLink } from '../data/file-links';
import {
  hashRequestBody,
  replayResponse,
  requireIdempotencyKey,
  storeResponse,
} from '../data/idempotency';
import { findLink, liveLinkOrder, markLinkUsed, requireLiveLink } from '../data/inspection-links';
import { loadOrderAggregate, type OrderAggregate } from '../data/orders';
import { enqueueEmail, recordAudit } from '../data/outbox';
import { computeOrderFigures } from '../domain/figures';
import { newId } from '../domain/ids';
import { nextDropStatus, nextOrderStatus } from '../domain/transitions';
import { apiError } from '../http/errors';
import { parseMultipart } from '../http/multipart';
import { PHOTO_BYTE_LIMIT, type Ctx, type Reply, type Route } from '../http/router';
import { FieldErrors, lengthWithin, scaledDecimal, trimmedString } from '../http/validate';
import {
  recordBalanceInvoice,
  saveBalanceInvoiceId,
  voidBalanceInvoice,
} from '../services/billing';
import { signedReportNotice } from '../services/emails';
import { renderInspectionReportPdf, type ReportBlock } from '../services/report-pdf';
import {
  deleteObjectQuietly,
  detectPhotoType,
  photoObjectKey,
  putObject,
  reportObjectKey,
} from '../services/storage';
import { pumpOutbox } from '../workers/outbox';
import { blockStrengthView, inspectionSheetView } from '../views/inspection';
import { photoFileName } from './files';

const MAX_PHOTOS_PER_SAMPLE = 4;
const MAX_FRAMES_TENTHS = 200;

function strengthReply(order: OrderAggregate, blockId: string, status: number): Reply {
  const figures = computeOrderFigures(order);
  return {
    status,
    json: {
      block: blockStrengthView(figures, blockId),
      payable_cents: figures.payableCents,
    },
  };
}

async function addSample(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token as string;
  const sampleId = newId('smp');
  const blockId = await withTransaction(async (client) => {
    const { order } = await liveLinkOrder(client, token);
    const chosenBlockId = trimmedString(ctx.body.json.block_id);
    const block = order.blocks.find((entry) => entry.blockId === chosenBlockId);
    if (block === undefined) throw apiError.notFound();

    const figures = computeOrderFigures(order);
    const strength = figures.blocks.get(block.blockId);
    const fields = new FieldErrors();

    const dropId = trimmedString(ctx.body.json.drop_id);
    const drop = order.drops.find(
      (entry) => entry.id === dropId && entry.blockId === block.blockId,
    );
    if (drop === undefined) fields.add('drop_id', 'Choose a yard delivered to this block');

    const colonyLabel = trimmedString(ctx.body.json.colony_label);
    if (!lengthWithin(colonyLabel, 1, 20)) {
      fields.add('colony_label', 'Colony must be 1 to 20 characters');
    } else if (
      order.samples.some(
        (sample) => sample.blockId === block.blockId && sample.colonyLabel === colonyLabel,
      )
    ) {
      fields.add('colony_label', `Colony ${colonyLabel} is already sampled in ${block.name}`);
    }

    const framesTenths = scaledDecimal(ctx.body.json.frames, 1);
    if (framesTenths === null || framesTenths < 0 || framesTenths > MAX_FRAMES_TENTHS) {
      fields.add('frames', 'Frames must be from 0.0 to 20.0 with one decimal');
    }

    if ((strength?.sampleCount ?? 0) >= (strength?.hivesDelivered ?? 0)) {
      fields.add('block_id', `${block.name} already has a sample for every hive`);
    }
    fields.throwIfAny();

    await client.query(
      `insert into samples (id, order_id, block_id, drop_id, colony_label, frames_tenths)
       values ($1,$2,$3,$4,$5,$6)`,
      [sampleId, order.id, block.blockId, dropId, colonyLabel, framesTenths],
    );
    await recordAudit(client, {
      entityType: 'sample',
      entityId: sampleId,
      action: 'added',
      actorId: null,
      detail: { order_id: order.id, block_id: block.blockId, frames_tenths: framesTenths },
    });
    return block.blockId;
  });

  const link = await findLink(pool, token);
  const order = await loadOrder(link.orderId);
  const figures = computeOrderFigures(order);
  const sample = order.samples.find((entry) => entry.id === sampleId);
  if (sample === undefined) throw apiError.notFound();
  return {
    status: 201,
    json: {
      sample: {
        id: sample.id,
        drop_id: sample.dropId,
        colony_label: sample.colonyLabel,
        frames: sample.framesTenths / 10,
        photos: [],
      },
      block: blockStrengthView(figures, blockId),
      payable_cents: figures.payableCents,
    },
  };
}

async function removeSample(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token as string;
  const sampleId = ctx.params.sampleId as string;
  const outcome = await withTransaction(async (client) => {
    const { order } = await liveLinkOrder(client, token);
    const sample = order.samples.find((entry) => entry.id === sampleId);
    if (sample === undefined) throw apiError.notFound();
    const keys = order.photos
      .filter((photo) => photo.sampleId === sampleId)
      .map((photo) => photo.objectKey);
    await client.query('delete from photos where sample_id = $1', [sampleId]);
    await client.query('delete from samples where id = $1', [sampleId]);
    await recordAudit(client, {
      entityType: 'sample',
      entityId: sampleId,
      action: 'removed',
      actorId: null,
      detail: { order_id: order.id, block_id: sample.blockId },
    });
    return { orderId: order.id, blockId: sample.blockId, keys };
  });
  for (const key of outcome.keys) await deleteObjectQuietly(key);
  return strengthReply(await loadOrder(outcome.orderId), outcome.blockId, 200);
}

async function addPhoto(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token as string;
  const sampleId = ctx.params.sampleId as string;
  const { link, order } = await liveLinkOrder(pool, token);
  const sample = order.samples.find((entry) => entry.id === sampleId);
  if (sample === undefined) throw apiError.notFound();

  if (ctx.body.overLimit) throw apiError.photoTooLarge();
  const files = parseMultipart(ctx.body.raw, ctx.body.contentType);
  const upload = files.find((file) => file.field === 'photo');
  if (upload === undefined) throw apiError.photoUnsupportedType();
  if (upload.bytes.length > PHOTO_BYTE_LIMIT) throw apiError.photoTooLarge();
  const contentType = detectPhotoType(upload.bytes);
  if (contentType === null) throw apiError.photoUnsupportedType();
  const existing = order.photos.filter((photo) => photo.sampleId === sampleId).length;
  if (existing >= MAX_PHOTOS_PER_SAMPLE) {
    throw apiError.validation({ photo: 'A sample holds at most 4 photos' });
  }

  const photoId = newId('pho');
  const objectKey = photoObjectKey(link.orderId, photoId, contentType);
  await putObject(objectKey, upload.bytes, contentType);
  await withTransaction(async (client) => {
    await client.query(
      `insert into photos (id, sample_id, order_id, object_key, content_type)
       values ($1,$2,$3,$4,$5)`,
      [photoId, sampleId, link.orderId, objectKey, contentType],
    );
    await recordAudit(client, {
      entityType: 'photo',
      entityId: photoId,
      action: 'added',
      actorId: null,
      detail: { order_id: link.orderId, sample_id: sampleId },
    });
  });
  return {
    status: 201,
    json: { photo: { id: photoId, url: `/api/inspect/${token}/photos/${photoId}` } },
  };
}

function reportBlocks(order: OrderAggregate): ReportBlock[] {
  const figures = computeOrderFigures(order);
  return order.blocks.map((block) => {
    const strength = figures.blocks.get(block.blockId);
    return {
      name: block.name,
      hivesDelivered: strength?.hivesDelivered ?? 0,
      averageText:
        strength === undefined || strength.averageTenths === null
          ? null
          : formatTenths(strength.averageTenths),
      tier: strength?.tier ?? null,
      payableCents: strength?.payableCents ?? 0,
      samples: order.samples
        .filter((sample) => sample.blockId === block.blockId)
        .map((sample) => ({
          colonyLabel: sample.colonyLabel,
          framesText: formatTenths(sample.framesTenths),
        })),
    };
  });
}

async function sign(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token as string;
  const link = await findLink(pool, token);
  const key = requireIdempotencyKey(ctx.headers);
  const scope = `sign:${link.id}`;
  const requestHash = hashRequestBody(ctx.body.json);
  const replay = await replayResponse(pool, scope, key, requestHash);
  if (replay !== null) return { status: replay.status, json: replay.body };
  requireLiveLink(link);

  const order = await loadOrderAggregate(pool, link.orderId);
  if (order === null) throw apiError.notFound();
  if (nextOrderStatus('sign', order.status) === null) {
    throw apiError.invalidTransition(
      orderStatusLabel(order.status, order.settlementStatus),
      order.ref,
    );
  }

  const fields = new FieldErrors();
  const inspectorName = trimmedString(ctx.body.json.inspector_name);
  if (!lengthWithin(inspectorName, 2, 80)) {
    fields.add('inspector_name', 'Full name must be 2 to 80 characters');
  }
  if (ctx.body.json.attest !== true) {
    fields.add('attest', 'Confirm that you counted these colonies');
  }
  const figures = computeOrderFigures(order);
  for (const block of order.blocks) {
    const strength = figures.blocks.get(block.blockId);
    if (strength === undefined || strength.hivesDelivered === 0) continue;
    const missing = strength.samplesRequired - strength.sampleCount;
    if (missing > 0) fields.add(block.blockId, `${block.name} needs ${missing} more samples`);
  }
  fields.throwIfAny();

  const signedAt = new Date();
  const reportKey = reportObjectKey(order.id, link.id);
  const pdf = renderInspectionReportPdf({
    orchardName: order.orchard.name,
    county: order.orchard.county,
    orderRef: order.ref,
    blocks: reportBlocks(order),
    payableCents: figures.payableCents,
    inspectorName: inspectorName as string,
    signedAt,
  });
  await putObject(reportKey, pdf, 'application/pdf');

  let balanceInvoiceId: string | null = null;
  try {
    const recorded = await recordBalanceInvoice(pool, order, figures);
    balanceInvoiceId = recorded.balanceInvoiceId;
  } catch (error) {
    await deleteObjectQuietly(reportKey);
    throw error;
  }

  const response = {
    status: 'signed' as const,
    signed_at: signedAt.toISOString(),
    payable_cents: figures.payableCents,
    blocks: order.blocks.map((block) => {
      const strength = figures.blocks.get(block.blockId);
      return {
        id: block.blockId,
        average_frames:
          strength === undefined || strength.averageTenths === null
            ? null
            : strength.averageTenths / 10,
        tier: strength?.tier ?? null,
        payable_cents: strength?.payableCents ?? 0,
      };
    }),
  };

  try {
    await withTransaction(async (client) => {
      await client.query(
        `update inspection_links set status = 'signed', signed_at = $2, inspector_name = $3,
           report_key = $4 where id = $1`,
        [link.id, signedAt.toISOString(), inspectorName, reportKey],
      );
      await client.query('update orders set status = $2 where id = $1', [
        order.id,
        nextOrderStatus('sign', order.status),
      ]);
      await client.query(`update drops set status = $2 where order_id = $1 and status = $3`, [
        order.id,
        nextDropStatus('sign', 'delivered'),
        'delivered',
      ]);
      await saveBalanceInvoiceId(client, order.id, balanceInvoiceId);
      await enqueueEmail(client, signedReportNotice(order, figures, link.id));
      await storeResponse(client, scope, key, requestHash, { status: 200, body: response });
      await recordAudit(client, {
        entityType: 'inspection_link',
        entityId: link.id,
        action: 'signed',
        actorId: null,
        detail: { order_id: order.id, payable_cents: figures.payableCents },
      });
    });
  } catch (error) {
    await voidBalanceInvoice(balanceInvoiceId).catch(() => undefined);
    await deleteObjectQuietly(reportKey);
    throw error;
  }
  void pumpOutbox();
  return { status: 200, json: response };
}

export const inspectRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/inspect/:token',
    body: 'none',
    auth: 'public',
    handle: async (ctx) => {
      const token = ctx.params.token as string;
      const sheet = await withTransaction(async (client) => {
        const { link, order } = await liveLinkOrder(client, token);
        await markLinkUsed(client, link);
        return inspectionSheetView(order, computeOrderFigures(order), link, token);
      });
      return { status: 200, json: sheet };
    },
  },
  {
    method: 'POST',
    path: '/api/inspect/:token/samples',
    body: 'json',
    auth: 'public',
    handle: addSample,
  },
  {
    method: 'DELETE',
    path: '/api/inspect/:token/samples/:sampleId',
    body: 'none',
    auth: 'public',
    handle: removeSample,
  },
  {
    method: 'POST',
    path: '/api/inspect/:token/samples/:sampleId/photos',
    body: 'multipart',
    auth: 'public',
    handle: addPhoto,
  },
  {
    method: 'GET',
    path: '/api/inspect/:token/photos/:photoId',
    body: 'none',
    auth: 'public',
    handle: async (ctx) => {
      const token = ctx.params.token as string;
      const { order } = await liveLinkOrder(pool, token);
      const photo = order.photos.find((entry) => entry.id === ctx.params.photoId);
      if (photo === undefined) throw apiError.notFound();
      const location = await issueFileLink(pool, {
        objectKey: photo.objectKey,
        contentType: photo.contentType,
        filename: photoFileName(photo.id, photo.contentType),
      });
      return { status: 302, headers: { Location: location, 'Cache-Control': 'private, no-store' } };
    },
  },
  {
    method: 'POST',
    path: '/api/inspect/:token/sign',
    body: 'json',
    auth: 'public',
    handle: sign,
  },
];
