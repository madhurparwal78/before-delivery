import { now } from '../clock.ts';
import { first, lockAll, lockKey, pool, rows, transaction, type Queryable } from '../db/pool.ts';
import { startOfNextStudioDay } from '../domain/studio-day.ts';
import { checkInTarget } from '../domain/transitions.ts';
import {
  cubicInches,
  inchesFromHalves,
  quote,
  type Membership,
  type RateSchedule,
} from '../domain/quote.ts';
import { publish } from '../events.ts';
import { ApiError, ValidationBag } from '../http/errors.ts';
import { V } from '../http/messages.ts';
import { detectPhotoKind, photoExtension, PHOTO_FILE_LIMIT } from '../http/boundary.ts';
import { safeParam } from '../http/pipeline.ts';
import { deleteObject, getObject, putObject, StorageUnavailable } from '../services/s3.ts';
import { isUuid, newId } from '../security.ts';
import { formatStudioDate, PIECE_STATUS_LABELS, type PieceStatus } from '../../shared/labels.ts';
import { passportBody, pieceById, studioToday, ticketBody, type PieceRow } from '../views.ts';
import { PIECE_COLUMNS, PIECE_FROM } from '../views.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

const PIECE_STATES = Object.keys(PIECE_STATUS_LABELS) as PieceStatus[];

export function pieceLock(pieceId: string): bigint {
  return lockKey('piece', pieceId);
}

export async function scheduleInForce(
  client: Queryable,
  studioId: string,
  studioDay: string,
): Promise<RateSchedule> {
  const found = await first<RateSchedule>(
    client,
    `select id, effective_from, member_bisque_cents, member_glaze_cents,
            dropoff_bisque_cents, dropoff_glaze_cents
       from rate_schedules
      where studio_id = $1 and effective_from <= $2
      order by effective_from desc limit 1`,
    [studioId, studioDay],
  );
  if (!found) throw new ApiError('not_found');
  return found;
}

function dimension(bag: ValidationBag, field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 24) {
    bag.add(field, V.dimension);
    return 0;
  }
  const hundredths = Math.round(value * 100);
  if (Math.abs(value * 100 - hundredths) > 1e-6) {
    bag.add(field, V.dimension);
    return 0;
  }
  return hundredths;
}

function readDimensions(json: Record<string, unknown>): {
  lengthHundredths: number;
  widthHundredths: number;
  heightHundredths: number;
} {
  const bag = new ValidationBag();
  const lengthHundredths = dimension(bag, 'length_in', json['length_in']);
  const widthHundredths = dimension(bag, 'width_in', json['width_in']);
  const heightHundredths = dimension(bag, 'height_in', json['height_in']);
  bag.throwIfAny();
  return { lengthHundredths, widthHundredths, heightHundredths };
}

function membershipOf(ctx: Ctx): Membership {
  return ctx.actorOrFail.membership === 'drop_off' ? 'drop_off' : 'member';
}

async function makeQuote(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const dims = readDimensions(ctx.json);
  const schedule = await scheduleInForce(
    pool,
    actor.studio.id,
    studioToday(actor.studio.time_zone),
  );
  const result = quote(dims, membershipOf(ctx), schedule);
  return {
    status: 200,
    body: {
      length_in: inchesFromHalves(result.roundedLengthHalves),
      width_in: inchesFromHalves(result.roundedWidthHalves),
      height_in: inchesFromHalves(result.roundedHeightHalves),
      cubic_inches: cubicInches(result.volumeEighths),
      membership: membershipOf(ctx),
      rates_effective_from: result.ratesEffectiveFrom,
      bisque: { rate_cents: result.bisqueRateCents, fee_cents: result.bisqueFeeCents },
      glaze: { rate_cents: result.glazeRateCents, fee_cents: result.glazeFeeCents },
    },
  };
}

async function logPiece(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const title = (typeof ctx.json['title'] === 'string' ? ctx.json['title'] : '').trim();
  const clayBodyId = typeof ctx.json['clay_body_id'] === 'string' ? ctx.json['clay_body_id'] : '';
  const bag = new ValidationBag();
  if (title.length < 1 || title.length > 80) bag.add('title', V.title);
  const clayBody =
    isUuid(clayBodyId) &&
    (await first<{ id: string }>(
      pool,
      'select id from clay_bodies where id = $1 and studio_id = $2',
      [clayBodyId, actor.studio.id],
    ));
  if (!clayBody) bag.add('clay_body_id', V.clayBody);
  const lengthHundredths = dimension(bag, 'length_in', ctx.json['length_in']);
  const widthHundredths = dimension(bag, 'width_in', ctx.json['width_in']);
  const heightHundredths = dimension(bag, 'height_in', ctx.json['height_in']);
  bag.throwIfAny();

  const membership = membershipOf(ctx);
  const schedule = await scheduleInForce(
    pool,
    actor.studio.id,
    studioToday(actor.studio.time_zone),
  );
  const result = quote({ lengthHundredths, widthHundredths, heightHundredths }, membership, schedule);
  const id = newId();
  const at = now();
  const body = await transaction(async (client) => {
    await client.query(
      `insert into pieces (id, studio_id, member_id, title, clay_body_id,
         length_hundredths, width_hundredths, height_hundredths,
         r_length_halves, r_width_halves, r_height_halves, cubic_eighths,
         membership, rates_effective_from, bisque_rate_cents, bisque_fee_cents,
         glaze_rate_cents, glaze_fee_cents, quoted_at, status, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'logged',$20)`,
      [
        id,
        actor.studio.id,
        actor.personId,
        title,
        clayBodyId,
        lengthHundredths,
        widthHundredths,
        heightHundredths,
        result.roundedLengthHalves,
        result.roundedWidthHalves,
        result.roundedHeightHalves,
        result.volumeEighths,
        membership,
        result.ratesEffectiveFrom,
        result.bisqueRateCents,
        result.bisqueFeeCents,
        result.glazeRateCents,
        result.glazeFeeCents,
        at,
        at,
      ],
    );
    await client.query('insert into piece_history (piece_id, status, at) values ($1,$2,$3)', [
      id,
      'logged',
      at,
    ]);
    await publish(client, {
      kind: 'piece',
      id,
      studio_id: actor.studio.id,
      member_id: actor.personId,
    });
    const row = (await pieceById(client, actor.studio.id, id)) as PieceRow;
    return passportBody(client, row);
  });
  return { status: 201, body };
}

async function listPieces(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  if (actor.role === 'member') {
    const own = await rows<PieceRow>(
      pool,
      `select ${PIECE_COLUMNS} ${PIECE_FROM}
        where p.studio_id = $1 and p.member_id = $2 order by p.created_at desc, p.id desc`,
      [actor.studio.id, actor.personId],
    );
    const bodies = [];
    for (const row of own) bodies.push(await passportBody(pool, row));
    return { status: 200, body: bodies };
  }
  const bag = new ValidationBag();
  const statusFilter = ctx.query.get('status');
  const unplaced = ctx.query.get('unplaced');
  if (statusFilter !== null && !PIECE_STATES.includes(statusFilter as PieceStatus)) {
    bag.add('status', V.pieceStatus);
  }
  if (unplaced !== null && unplaced !== '1') bag.add('unplaced', V.unplaced);
  bag.throwIfAny();

  const conditions = ['p.studio_id = $1', "not (p.status = 'logged' and not owner.active)"];
  const params: unknown[] = [actor.studio.id];
  if (statusFilter !== null) {
    params.push(statusFilter);
    conditions.push(`p.status = $${params.length}`);
  }
  if (unplaced === '1') {
    conditions.push('not exists (select 1 from piece_open_load ol where ol.piece_id = p.id)');
  }
  const found = await rows<PieceRow>(
    pool,
    `select ${PIECE_COLUMNS} ${PIECE_FROM} where ${conditions.join(' and ')}
      order by p.waiting_since asc nulls last, p.created_at asc, p.id asc`,
    params,
  );
  return { status: 200, body: found.map(ticketBody) };
}

async function resolvePiece(ctx: Ctx): Promise<void> {
  const id = safeParam(ctx, 'id');
  if (!isUuid(id)) throw new ApiError('not_found');
  const actor = ctx.actorOrFail;
  const piece = await pieceById(pool, actor.studio.id, id);
  if (!piece) throw new ApiError('not_found');
  if (actor.role === 'member' && piece.member_id !== actor.personId) {
    throw new ApiError('not_found');
  }
  ctx.store['piece'] = piece;
}

function heldPiece(ctx: Ctx): PieceRow {
  return ctx.store['piece'] as PieceRow;
}

function requireOwningMember(ctx: Ctx): void {
  const actor = ctx.actorOrFail;
  if (actor.role !== 'member' || heldPiece(ctx).member_id !== actor.personId) {
    throw new ApiError('forbidden');
  }
}

async function readPassport(ctx: Ctx): Promise<RouteResult> {
  return { status: 200, body: await passportBody(pool, heldPiece(ctx)) };
}

async function uploadPhoto(ctx: Ctx): Promise<RouteResult> {
  requireOwningMember(ctx);
  const actor = ctx.actorOrFail;
  const piece = heldPiece(ctx);
  const upload = ctx.upload;

  const prepared = await transaction(async (client) => {
    await lockAll(client, [pieceLock(piece.id)]);
    const fresh = await first<{ status: PieceStatus; photo_key: string | null }>(
      client,
      'select status, photo_key from pieces where id = $1',
      [piece.id],
    );
    if (!fresh || fresh.status !== 'logged') throw new ApiError('photo_locked');
    if (!upload || upload.bytes.byteLength === 0) throw new ApiError('unsupported_photo');
    if (upload.bytes.byteLength > PHOTO_FILE_LIMIT) throw new ApiError('photo_too_large');
    const kind = detectPhotoKind(upload.bytes);
    if (!kind) throw new ApiError('unsupported_photo');
    const key = `studios/${actor.studio.id}/pieces/${piece.id}/${newId()}.${photoExtension(kind)}`;
    try {
      await putObject(key, upload.bytes, kind);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
      throw error;
    }
    await client.query('update pieces set photo_key = $2 where id = $1', [piece.id, key]);
    await publish(client, {
      kind: 'piece',
      id: piece.id,
      studio_id: actor.studio.id,
      member_id: piece.member_id,
    });
    return fresh.photo_key;
  });
  if (prepared) await deleteObject(prepared).catch(() => undefined);
  return { status: 200, body: { photo_url: `/api/pieces/${piece.id}/photo` } };
}

async function readPhoto(ctx: Ctx): Promise<RouteResult> {
  const piece = heldPiece(ctx);
  if (!piece.photo_key) throw new ApiError('not_found');
  let bytes: Buffer | null;
  try {
    bytes = await getObject(piece.photo_key);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
    throw error;
  }
  if (!bytes) throw new ApiError('not_found');
  const kind = detectPhotoKind(bytes) ?? 'application/octet-stream';
  return {
    status: 200,
    raw: {
      buffer: bytes,
      contentType: kind,
      headers: { 'cache-control': 'private, no-store' },
    },
  };
}

async function movePiece(
  ctx: Ctx,
  decide: (piece: PieceRow, client: Queryable) => Promise<PieceStatus[]>,
): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const piece = heldPiece(ctx);
  const body = await transaction(async (client) => {
    await lockAll(client, [pieceLock(piece.id)]);
    const fresh = (await pieceById(client, actor.studio.id, piece.id)) as PieceRow;
    const steps = await decide(fresh, client);
    const at = now();
    for (const step of steps) {
      await client.query('insert into piece_history (piece_id, status, at) values ($1,$2,$3)', [
        fresh.id,
        step,
        at,
      ]);
    }
    const last = steps[steps.length - 1] as PieceStatus;
    const waiting = last === 'waiting_bisque' || last === 'waiting_glaze' ? at : null;
    const leftReady = last === 'collected' || last === 'uncollected' ? at : null;
    await client.query(
      `update pieces set status = $2,
         waiting_since = case when $3::timestamptz is null then waiting_since else $3 end,
         left_ready_at = case when $4::timestamptz is null then left_ready_at else $4 end
       where id = $1`,
      [fresh.id, last, waiting, leftReady],
    );
    await publish(client, {
      kind: 'piece',
      id: fresh.id,
      studio_id: actor.studio.id,
      member_id: fresh.member_id,
    });
    const updated = (await pieceById(client, actor.studio.id, fresh.id)) as PieceRow;
    return passportBody(client, updated);
  });
  return { status: 200, body };
}

async function checkIn(ctx: Ctx): Promise<RouteResult> {
  return movePiece(ctx, async (piece, client) => {
    const target = checkInTarget(piece.status);
    if (!target) throw new ApiError('illegal_transition', `${piece.title} can't be checked in now.`);
    if (target === 'waiting_bisque') {
      const owner = await first<{ active: boolean }>(
        client,
        'select active from people where id = $1',
        [piece.member_id],
      );
      if (!owner || !owner.active) {
        throw new ApiError('member_inactive', `${piece.title} belongs to an inactive member.`);
      }
      if (!piece.photo_key) {
        throw new ApiError('photo_required', `${piece.title} needs an intake photo before check-in.`);
      }
    }
    return [target];
  });
}

async function collect(ctx: Ctx): Promise<RouteResult> {
  return movePiece(ctx, async (piece) => {
    if (piece.status !== 'ready_for_pickup') {
      throw new ApiError('illegal_transition', `${piece.title} can't be collected now.`);
    }
    return ['collected'];
  });
}

async function markUncollected(ctx: Ctx): Promise<RouteResult> {
  const timeZone = ctx.actorOrFail.studio.time_zone;
  return movePiece(ctx, async (piece) => {
    if (piece.pickup_deadline) {
      const dayEnds = startOfNextStudioDay(piece.pickup_deadline, timeZone);
      if (now().getTime() < dayEnds.getTime()) {
        throw new ApiError(
          'pickup_not_due',
          `${piece.title} can still be collected until the end of ${formatStudioDate(piece.pickup_deadline)}.`,
        );
      }
    }
    if (piece.status !== 'ready_for_pickup') {
      throw new ApiError('illegal_transition', `${piece.title} can't be marked uncollected now.`);
    }
    return ['uncollected'];
  });
}

export const pieceRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/quotes', role: 'member', handle: makeQuote },
  { method: 'POST', pattern: '/api/pieces', role: 'member', handle: logPiece },
  { method: 'GET', pattern: '/api/pieces', role: 'signed_in', handle: listPieces },
  {
    method: 'GET',
    pattern: '/api/pieces/:id',
    role: 'signed_in',
    resolve: resolvePiece,
    handle: readPassport,
  },
  {
    method: 'PUT',
    pattern: '/api/pieces/:id/photo',
    role: 'signed_in',
    bodyMode: 'multipart',
    resolve: resolvePiece,
    handle: uploadPhoto,
  },
  {
    method: 'GET',
    pattern: '/api/pieces/:id/photo',
    role: 'signed_in',
    resolve: resolvePiece,
    handle: readPhoto,
  },
  {
    method: 'POST',
    pattern: '/api/pieces/:id/check-in',
    role: 'staff',
    resolve: resolvePiece,
    handle: checkIn,
  },
  {
    method: 'POST',
    pattern: '/api/pieces/:id/collect',
    role: 'staff',
    resolve: resolvePiece,
    handle: collect,
  },
  {
    method: 'POST',
    pattern: '/api/pieces/:id/mark-uncollected',
    role: 'owner',
    resolve: resolvePiece,
    handle: markUncollected,
  },
];
