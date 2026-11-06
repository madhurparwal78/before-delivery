import { requireRole, requireSession } from '../auth.ts';
import { LIMITS } from '../config.ts';
import { query, queryOne, transact } from '../db/pool.ts';
import { FIELD_COPY, STATUS_COPY, staleStart } from '../../domain/copy.ts';
import { graphemeCount } from '../../domain/text.ts';
import { formatCopenhagenInstant, formatInstant } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import {
  ApiError,
  notFound,
  staleVersion,
  tooLarge,
  unsupportedMediaType,
  validationFailed,
} from '../http/errors.ts';
import { PartTooLarge, readMultipart } from '../http/multipart.ts';
import { sendJson } from '../http/respond.ts';
import { integer, list, Problems } from '../http/validate.ts';
import { newId } from '../services/crypto.ts';
import { prepareLookImage } from '../services/images.ts';
import { extensionFor, lookObjectKey, putObject, StorageUnavailable } from '../services/storage.ts';
import { requireDrop } from './drops.ts';
import { serveLookBytes } from './publicdrops.ts';

interface LookRow {
  id: string;
  drop_id: string;
  position: number;
  title: string;
  alt_text: string;
  width: number;
  height: number;
  content_type: string;
  size_bytes: number;
  object_key: string;
}

interface OrderRow {
  order_version: number;
  saved_by: string;
  saved_at_ms: number;
}

function lookShape(row: LookRow, dropId: string): Record<string, unknown> {
  return {
    id: row.id,
    position: row.position + 1,
    title: row.title,
    altText: row.alt_text,
    width: row.width,
    height: row.height,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    imageUrl: `/api/drops/${dropId}/looks/${row.id}/image`,
  };
}

async function orderOf(dropId: string): Promise<OrderRow> {
  const row = await queryOne<OrderRow>(
    'select order_version, saved_by, saved_at_ms from look_orders where drop_id = $1',
    [dropId],
  );
  if (row === null) throw notFound();
  return row;
}

async function looksOf(dropId: string): Promise<LookRow[]> {
  return query<LookRow>('select * from looks where drop_id = $1 order by position', [dropId]);
}

async function sendLooks(ctx: Ctx, dropId: string, status = 200): Promise<void> {
  const order = await orderOf(dropId);
  const looks = await looksOf(dropId);
  sendJson(ctx.response, status, {
    items: looks.map((look) => lookShape(look, dropId)),
    orderVersion: order.order_version,
    savedBy: order.saved_by,
    savedAt: formatInstant(Number(order.saved_at_ms)),
  });
}

export async function listLooks(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser', 'launch_producer', 'finance_lead', 'press_lead');
  await sendLooks(ctx, drop.id);
}

export async function getLookImage(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  const look = await queryOne<LookRow>('select * from looks where id = $1 and drop_id = $2', [
    ctx.params['lookId'] as string,
    drop.id,
  ]);
  if (look === null) throw notFound();
  await serveLookBytes(ctx, look);
}

export async function uploadLook(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser');

  let fields: Record<string, string>;
  let fileBytes: Buffer | null = null;
  try {
    const multipart = await readMultipart(ctx, LIMITS.lookFileBytes);
    fields = multipart.fields;
    fileBytes = multipart.files.find((entry) => entry.fieldName === 'file')?.bytes ?? null;
  } catch (error) {
    if (error instanceof PartTooLarge) throw tooLarge(STATUS_COPY.lookTooLarge);
    if (error instanceof ApiError && error.status === 415) {
      throw unsupportedMediaType(FIELD_COPY.imageType);
    }
    throw error;
  }

  const problems = new Problems();
  const title = (fields['title'] ?? '').trim();
  const altText = (fields['altText'] ?? '').trim();
  if (title === '') problems.add('title', FIELD_COPY.required);
  else if (graphemeCount(title) > 80) problems.add('title', FIELD_COPY.tooLong(80));
  if (altText === '') problems.add('altText', FIELD_COPY.required);
  else if (graphemeCount(altText) > 250) problems.add('altText', FIELD_COPY.tooLong(250));
  if (fileBytes === null || fileBytes.length === 0) problems.add('file', FIELD_COPY.required);
  problems.throwIfAny();

  const prepared = prepareLookImage(fileBytes as Buffer);
  if (prepared === 'type') throw validationFailed({ file: FIELD_COPY.imageType });
  if (prepared === 'pixels') throw validationFailed({ file: FIELD_COPY.imagePixels });

  const lookId = newId();
  const objectKey = lookObjectKey(drop.id, lookId, extensionFor(prepared.contentType));
  try {
    await putObject(objectKey, prepared.bytes, prepared.contentType);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      throw new ApiError(503, 'storage_unavailable', { message: STATUS_COPY.lookStorageDown });
    }
    throw error;
  }

  await transact(async (tx) => {
    const next = await tx.queryOne<{ next: number }>(
      'select coalesce(max(position), -1) + 1 as next from looks where drop_id = $1',
      [drop.id],
    );
    await tx.query(
      `insert into looks (id, drop_id, position, title, alt_text, width, height, content_type, size_bytes, object_key, created_at_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        lookId,
        drop.id,
        Number(next?.next ?? 0),
        title,
        altText,
        prepared.width,
        prepared.height,
        prepared.contentType,
        prepared.bytes.length,
        objectKey,
        ctx.nowMs,
      ],
    );
    await tx.query(
      'update look_orders set order_version = order_version + 1, saved_by = $2, saved_at_ms = $3 where drop_id = $1',
      [drop.id, session.name, ctx.nowMs],
    );
  });

  const order = await orderOf(drop.id);
  const look = await queryOne<LookRow>('select * from looks where id = $1', [lookId]);
  if (look === null) throw notFound();
  sendJson(ctx.response, 201, {
    look: lookShape(look, drop.id),
    orderVersion: order.order_version,
  });
}

export async function reorderLooks(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser');

  const body = ctx.json();
  const problems = new Problems();
  const orderVersion = integer(problems, body, 'orderVersion', 1, 1_000_000_000);
  const ids = list(body, 'lookIds').map((entry) => (typeof entry === 'string' ? entry : ''));
  problems.throwIfAny();

  const order = await orderOf(drop.id);
  if (orderVersion !== order.order_version) throw await staleOrder(drop.id, order);

  const current = await looksOf(drop.id);
  const sameSet =
    ids.length === current.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => current.some((look) => look.id === id));
  if (!sameSet) throw validationFailed({ lookIds: FIELD_COPY.required });

  await transact(async (tx) => {
    const locked = await tx.queryOne<OrderRow>(
      'select order_version, saved_by, saved_at_ms from look_orders where drop_id = $1 for update',
      [drop.id],
    );
    if (Number(locked?.order_version) !== orderVersion) throw await staleOrder(drop.id, order);
    for (const [position, id] of ids.entries()) {
      await tx.query('update looks set position = $3 where id = $1 and drop_id = $2', [
        id,
        drop.id,
        position,
      ]);
    }
    await tx.query(
      'update look_orders set order_version = order_version + 1, saved_by = $2, saved_at_ms = $3 where drop_id = $1',
      [drop.id, session.name, ctx.nowMs],
    );
  });

  await sendLooks(ctx, drop.id);
}

async function staleOrder(dropId: string, order: OrderRow): Promise<ApiError> {
  const looks = await looksOf(dropId);
  return staleVersion(
    order.saved_by,
    formatInstant(Number(order.saved_at_ms)),
    {
      items: looks.map((look) => lookShape(look, dropId)),
      orderVersion: order.order_version,
      savedBy: order.saved_by,
      savedAt: formatInstant(Number(order.saved_at_ms)),
    },
    staleStart(order.saved_by, formatCopenhagenInstant(Number(order.saved_at_ms))),
  );
}
