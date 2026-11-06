import { now } from '../clock.ts';
import { first, lockAll, lockKey, pool, rows, transaction, type Queryable } from '../db/pool.ts';
import {
  deckGeometry,
  footprintOverLimit,
  footprintPctTenths,
  formatHeadroom,
  formatPct,
  headroomEighths,
  type DeckPiece,
} from '../domain/load.ts';
import { addDays, studioDate } from '../domain/studio-day.ts';
import { KILN_BUSY_STATUSES, loadMayMove, OPEN_LOAD_STATUSES } from '../domain/transitions.ts';
import { publish } from '../events.ts';
import { ApiError, ValidationBag } from '../http/errors.ts';
import { V } from '../http/messages.ts';
import { safeParam } from '../http/pipeline.ts';
import { queueEmail, settleCharge, unloadClaim } from '../money.ts';
import { isUuid, newId } from '../security.ts';
import { REQUEST_BUDGET_MS } from '../services/killbill.ts';
import {
  formatStudioDate,
  LOAD_STATUS_LABELS,
  type LoadStatus,
  type Outcome,
} from '../../shared/labels.ts';
import {
  CHARGE_COLUMNS,
  chargeBody,
  loadBody,
  loadById,
  LOAD_SELECT,
  type ChargeRow,
  type LoadRow,
} from '../views.ts';
import { pieceLock } from './pieces.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

const SHELF_EIGHTHS = 5;
const OUTCOMES: readonly Outcome[] = ['intact', 'cracked', 'damaged'];

function loadLock(loadId: string): bigint {
  return lockKey('load', loadId);
}

function kilnLock(kilnId: string): bigint {
  return lockKey('kiln', kilnId);
}

interface StatePiece extends DeckPiece {
  readonly pieceId: string;
}

interface DeckState {
  readonly number: number;
  pieces: StatePiece[];
}

interface PlacedRow {
  readonly piece_id: string;
  readonly deck: number;
  readonly r_length_halves: number;
  readonly r_width_halves: number;
  readonly r_height_halves: number;
}

async function deckStates(client: Queryable, loadId: string): Promise<DeckState[]> {
  const deckNumbers = await rows<{ number: number }>(
    client,
    'select number from load_decks where load_id = $1 order by number',
    [loadId],
  );
  const placed = await rows<PlacedRow>(
    client,
    `select pl.piece_id, pl.deck, p.r_length_halves, p.r_width_halves, p.r_height_halves
       from placements pl join pieces p on p.id = pl.piece_id
      where pl.load_id = $1 order by pl.deck, pl.position`,
    [loadId],
  );
  return deckNumbers.map((deck) => ({
    number: deck.number,
    pieces: placed
      .filter((row) => row.deck === deck.number)
      .map((row) => ({
        pieceId: row.piece_id,
        roundedLengthHalves: row.r_length_halves,
        roundedWidthHalves: row.r_width_halves,
        roundedHeightHalves: row.r_height_halves,
      })),
  }));
}

function geometries(states: readonly DeckState[]): ReturnType<typeof deckGeometry>[] {
  return states.map((state) => deckGeometry(state.pieces));
}

/** The placement checks, used by placements and by moves alike. */
function checkFits(load: LoadRow, states: readonly DeckState[], deckNumber: number): void {
  const shapes = geometries(states);
  const headroom = headroomEighths(load.stack_height_eighths, shapes);
  if (headroom < 0) {
    throw new ApiError(
      'exceeds_headroom',
      `Too tall for this stack: headroom would be ${formatHeadroom(headroom)} in.`,
    );
  }
  const index = states.findIndex((state) => state.number === deckNumber);
  const shape = shapes[index] as ReturnType<typeof deckGeometry>;
  if (footprintOverLimit(shape.footprintQuarters, load.shelf_area_tenths)) {
    const pct = footprintPctTenths(shape.footprintQuarters, load.shelf_area_tenths);
    throw new ApiError(
      'exceeds_footprint',
      `Deck ${deckNumber} is full: footprint would be ${formatPct(pct)}%.`,
    );
  }
}

function deckOrFail(states: readonly DeckState[], value: unknown): DeckState {
  if (typeof value === 'number' && Number.isInteger(value)) {
    const found = states.find((state) => state.number === value);
    if (found) return found;
  }
  const bag = new ValidationBag();
  bag.add('deck', V.deck);
  bag.throwIfAny();
  throw new ApiError('not_found');
}

async function nextPosition(client: Queryable, loadId: string): Promise<number> {
  const found = await rows<{ next: number }>(
    client,
    'select coalesce(max(position), 0) + 1 as next from placements where load_id = $1',
    [loadId],
  );
  return found[0]?.next ?? 1;
}

async function resolveLoad(ctx: Ctx): Promise<void> {
  const id = safeParam(ctx, 'id');
  if (!isUuid(id)) throw new ApiError('not_found');
  const load = await loadById(pool, ctx.actorOrFail.studio.id, id);
  if (!load) throw new ApiError('not_found');
  ctx.store['load'] = load;
}

function heldLoad(ctx: Ctx): LoadRow {
  return ctx.store['load'] as LoadRow;
}

async function publishLoad(client: Queryable, load: LoadRow): Promise<void> {
  await publish(client, { kind: 'load', id: load.id, studio_id: load.studio_id });
}

/** A piece moved in or out of a load: staff and the piece's own member follow it. */
async function publishPiece(client: Queryable, studioId: string, pieceId: string): Promise<void> {
  const owner = await first<{ member_id: string }>(
    client,
    'select member_id from pieces where id = $1',
    [pieceId],
  );
  await publish(client, { kind: 'piece', id: pieceId, studio_id: studioId, member_id: owner?.member_id ?? null });
}

async function freshLoadBody(client: Queryable, load: LoadRow): Promise<Record<string, unknown>> {
  const refreshed = (await loadById(client, load.studio_id, load.id)) as LoadRow;
  return loadBody(client, refreshed);
}

async function createLoad(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const kilnId = typeof ctx.json['kiln_id'] === 'string' ? ctx.json['kiln_id'] : '';
  const firing = ctx.json['firing'];
  const kiln =
    isUuid(kilnId) &&
    (await first<{ id: string }>(pool, 'select id from kilns where id = $1 and studio_id = $2', [
      kilnId,
      actor.studio.id,
    ]));
  if (!kiln || (firing !== 'bisque' && firing !== 'glaze')) {
    const bag = new ValidationBag();
    bag.add('kiln_id', V.kilnFiring);
    bag.add('firing', V.kilnFiring);
    bag.throwIfAny();
  }

  const id = newId();
  const body = await transaction(async (client) => {
    await client.query(
      `insert into loads (id, studio_id, kiln_id, firing, status, created_at)
       values ($1,$2,$3,$4,'planning',$5)`,
      [id, actor.studio.id, kilnId, firing, now()],
    );
    await client.query('insert into load_decks (load_id, number) values ($1, 1)', [id]);
    await publish(client, { kind: 'load', id, studio_id: actor.studio.id });
    const created = (await loadById(client, actor.studio.id, id)) as LoadRow;
    return loadBody(client, created);
  });
  return { status: 201, body };
}

async function listLoads(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const openOnly = ctx.query.get('open') === '1';
  const found = await rows<LoadRow>(
    pool,
    `${LOAD_SELECT} where l.studio_id = $1 ${openOnly ? 'and l.status = any($2)' : ''}
      order by l.created_at desc`,
    openOnly ? [actor.studio.id, OPEN_LOAD_STATUSES] : [actor.studio.id],
  );
  const bodies: Record<string, unknown>[] = [];
  for (const load of found) bodies.push(await loadBody(pool, load));
  return { status: 200, body: bodies };
}

async function addDeck(ctx: Ctx): Promise<RouteResult> {
  const load = heldLoad(ctx);
  const body = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    if (fresh.status !== 'planning') throw new ApiError('load_not_planning');
    const states = await deckStates(client, load.id);
    const headroom = headroomEighths(fresh.stack_height_eighths, geometries(states)) - SHELF_EIGHTHS;
    if (headroom < 0) {
      throw new ApiError(
        'exceeds_headroom',
        `Too tall for this stack: headroom would be ${formatHeadroom(headroom)} in.`,
      );
    }
    const next = states.length === 0 ? 1 : (states[states.length - 1] as DeckState).number + 1;
    await client.query('insert into load_decks (load_id, number) values ($1, $2)', [load.id, next]);
    await publishLoad(client, fresh);
    return freshLoadBody(client, fresh);
  });
  return { status: 201, body };
}

async function removeDeck(ctx: Ctx): Promise<RouteResult> {
  const load = heldLoad(ctx);
  const raw = safeParam(ctx, 'number');
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) throw new ApiError('not_found');
  const number = Number.parseInt(raw, 10);
  const exists = await first<{ number: number }>(
    pool,
    'select number from load_decks where load_id = $1 and number = $2',
    [load.id, number],
  );
  if (!exists) throw new ApiError('not_found');

  const body = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    if (fresh.status !== 'planning') throw new ApiError('load_not_planning');
    const states = await deckStates(client, load.id);
    const top = states[states.length - 1];
    const target = states.find((state) => state.number === number);
    if (!target || !top || top.number !== number || target.pieces.length > 0) {
      throw new ApiError('deck_not_removable');
    }
    await client.query('delete from load_decks where load_id = $1 and number = $2', [
      load.id,
      number,
    ]);
    await publishLoad(client, fresh);
    return freshLoadBody(client, fresh);
  });
  return { status: 200, body };
}

function waitingStateFor(firing: 'bisque' | 'glaze'): string {
  return firing === 'bisque' ? 'waiting_bisque' : 'waiting_glaze';
}

interface PieceShapeRow {
  readonly title: string;
  readonly status: string;
  readonly r_length_halves: number;
  readonly r_width_halves: number;
  readonly r_height_halves: number;
}

async function placePiece(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const load = heldLoad(ctx);
  const pieceId = typeof ctx.json['piece_id'] === 'string' ? ctx.json['piece_id'] : '';
  if (!isUuid(pieceId)) throw new ApiError('not_found');
  const known = await first<{ id: string }>(
    pool,
    'select id from pieces where id = $1 and studio_id = $2',
    [pieceId, actor.studio.id],
  );
  if (!known) throw new ApiError('not_found');

  const body = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id), pieceLock(pieceId)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    if (fresh.status !== 'planning') throw new ApiError('load_not_planning');
    const piece = (await first<PieceShapeRow>(
      client,
      `select title, status, r_length_halves, r_width_halves, r_height_halves
         from pieces where id = $1`,
      [pieceId],
    )) as PieceShapeRow;
    if (piece.status !== waitingStateFor(fresh.firing)) {
      throw new ApiError('wrong_firing', `${piece.title} is waiting for a different firing.`);
    }
    const taken = await first<{ piece_id: string }>(
      client,
      'select piece_id from piece_open_load where piece_id = $1',
      [pieceId],
    );
    if (taken) {
      throw new ApiError('piece_taken', `Taken: ${piece.title} is already in another load.`);
    }
    const states = await deckStates(client, load.id);
    const deck = deckOrFail(states, ctx.json['deck']);
    deck.pieces.push({
      pieceId,
      roundedLengthHalves: piece.r_length_halves,
      roundedWidthHalves: piece.r_width_halves,
      roundedHeightHalves: piece.r_height_halves,
    });
    checkFits(fresh, states, deck.number);

    await client.query(
      'insert into placements (load_id, piece_id, deck, position) values ($1,$2,$3,$4)',
      [load.id, pieceId, deck.number, await nextPosition(client, load.id)],
    );
    await client.query('insert into piece_open_load (piece_id, load_id) values ($1,$2)', [
      pieceId,
      load.id,
    ]);
    await publishLoad(client, fresh);
    await publishPiece(client, actor.studio.id, pieceId);
    return freshLoadBody(client, fresh);
  });
  return { status: 201, body };
}

async function movePlacement(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const load = heldLoad(ctx);
  const pieceId = typeof ctx.json['piece_id'] === 'string' ? ctx.json['piece_id'] : '';
  if (!isUuid(pieceId)) throw new ApiError('not_found');

  const body = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id), pieceLock(pieceId)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    // A move that arrives after a cancel answers load_not_planning, so the load's own state is
    // read before asking whether the piece is still one of its placements.
    if (fresh.status !== 'planning') throw new ApiError('load_not_planning');
    const placement = await first<{ deck: number }>(
      client,
      'select deck from placements where load_id = $1 and piece_id = $2',
      [load.id, pieceId],
    );
    if (!placement) throw new ApiError('not_found');
    const states = await deckStates(client, load.id);
    const deck = deckOrFail(states, ctx.json['deck']);
    if (placement.deck !== deck.number) {
      const source = states.find((state) => state.number === placement.deck) as DeckState;
      const moved = source.pieces.find((piece) => piece.pieceId === pieceId) as StatePiece;
      source.pieces = source.pieces.filter((piece) => piece.pieceId !== pieceId);
      deck.pieces.push(moved);
      checkFits(fresh, states, deck.number);
      await client.query(
        'update placements set deck = $3, position = $4 where load_id = $1 and piece_id = $2',
        [load.id, pieceId, deck.number, await nextPosition(client, load.id)],
      );
      await publishLoad(client, fresh);
      await publishPiece(client, actor.studio.id, pieceId);
    }
    return freshLoadBody(client, fresh);
  });
  return { status: 200, body };
}

async function removePlacement(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const load = heldLoad(ctx);
  const pieceId = safeParam(ctx, 'piece_id');
  if (!isUuid(pieceId)) throw new ApiError('not_found');
  const body = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id), pieceLock(pieceId)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    if (fresh.status !== 'planning') throw new ApiError('load_not_planning');
    const placement = await first<{ deck: number }>(
      client,
      'select deck from placements where load_id = $1 and piece_id = $2',
      [load.id, pieceId],
    );
    if (!placement) throw new ApiError('not_found');
    await client.query('delete from placements where load_id = $1 and piece_id = $2', [
      load.id,
      pieceId,
    ]);
    await client.query('delete from piece_open_load where piece_id = $1 and load_id = $2', [
      pieceId,
      load.id,
    ]);
    await publishLoad(client, fresh);
    await publishPiece(client, actor.studio.id, pieceId);
    return freshLoadBody(client, fresh);
  });
  return { status: 200, body };
}

async function changeStatus(ctx: Ctx): Promise<RouteResult> {
  const load = heldLoad(ctx);
  const wanted = ctx.json['status'];
  if (wanted !== 'loaded' && wanted !== 'firing' && wanted !== 'cooling' && wanted !== 'cancelled') {
    const bag = new ValidationBag();
    bag.add('status', V.loadStatus);
    bag.throwIfAny();
  }
  const target = wanted as LoadStatus;
  const body = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id), kilnLock(load.kiln_id)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    if (!loadMayMove(fresh.status, target)) {
      throw new ApiError(
        'illegal_transition',
        `Load can't move from ${LOAD_STATUS_LABELS[fresh.status]} to ${LOAD_STATUS_LABELS[target]}.`,
      );
    }
    if (target === 'loaded') {
      const count = await rows<{ pieces: number }>(
        client,
        'select count(*)::bigint as pieces from placements where load_id = $1',
        [load.id],
      );
      if ((count[0]?.pieces ?? 0) === 0) throw new ApiError('empty_load');
      const busy = await first<{ id: string }>(
        client,
        'select id from loads where kiln_id = $1 and status = any($2) and id <> $3',
        [fresh.kiln_id, KILN_BUSY_STATUSES, fresh.id],
      );
      if (busy) throw new ApiError('kiln_busy', `${fresh.kiln_name} already has a load in it.`);
    }
    await client.query('update loads set status = $2 where id = $1', [load.id, target]);
    if (target === 'cancelled') {
      const held = await rows<{ piece_id: string }>(
        client,
        'select piece_id from placements where load_id = $1',
        [load.id],
      );
      await client.query('delete from placements where load_id = $1', [load.id]);
      await client.query('delete from piece_open_load where load_id = $1', [load.id]);
      for (const piece of held) {
        await publishPiece(client, fresh.studio_id, piece.piece_id);
      }
    }
    await publishLoad(client, fresh);
    return freshLoadBody(client, fresh);
  });
  return { status: 200, body };
}

interface UnloadPieceRow {
  readonly piece_id: string;
  readonly title: string;
  readonly member_id: string;
  readonly member_email: string;
  readonly bisque_fee_cents: number;
  readonly glaze_fee_cents: number;
  readonly bisque_rate_cents: number;
  readonly glaze_rate_cents: number;
  readonly cubic_eighths: number;
}

async function unload(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const load = heldLoad(ctx);

  const prepared = await transaction(async (client) => {
    await lockAll(client, [loadLock(load.id)]);
    const fresh = (await loadById(client, load.studio_id, load.id)) as LoadRow;
    if (fresh.status !== 'cooling') {
      throw new ApiError('illegal_transition', "This load can't be unloaded now.");
    }
    const pieces = await rows<UnloadPieceRow>(
      client,
      `select pl.piece_id, p.title, p.member_id, m.email as member_email,
              p.bisque_fee_cents, p.glaze_fee_cents, p.bisque_rate_cents, p.glaze_rate_cents,
              p.cubic_eighths
         from placements pl
         join pieces p on p.id = pl.piece_id
         join people m on m.id = p.member_id
        where pl.load_id = $1
        order by pl.deck, pl.position`,
      [load.id],
    );
    const raw = ctx.json['outcomes'];
    const given =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    const bag = new ValidationBag();
    if (!given || Object.keys(given).length !== pieces.length) {
      bag.add('outcomes', V.outcomes);
    } else {
      for (const piece of pieces) {
        const value = given[piece.piece_id];
        if (typeof value !== 'string' || !OUTCOMES.includes(value as Outcome)) {
          bag.add('outcomes', V.outcomes);
          break;
        }
      }
    }
    bag.throwIfAny();
    const chosen = given as Record<string, Outcome>;

    const at = now();
    const deadline =
      fresh.firing === 'glaze'
        ? addDays(studioDate(at, actor.studio.time_zone), actor.studio.pickup_window_days)
        : null;
    await client.query('update loads set status = $2, unloaded_at = $3 where id = $1', [
      load.id,
      'unloaded',
      at,
    ]);

    const chargeIds: string[] = [];
    for (const piece of pieces) {
      const outcome = chosen[piece.piece_id] as Outcome;
      if (fresh.firing === 'bisque') {
        await client.query(
          `update pieces set bisque_outcome = $2, status = 'bisqued', waiting_since = null
            where id = $1`,
          [piece.piece_id, outcome],
        );
        await client.query('insert into piece_history (piece_id, status, at) values ($1,$2,$3)', [
          piece.piece_id,
          'bisqued',
          at,
        ]);
      } else {
        await client.query(
          `update pieces set glaze_outcome = $2, status = 'ready_for_pickup',
                 waiting_since = null, pickup_deadline = $3
            where id = $1`,
          [piece.piece_id, outcome, deadline],
        );
        for (const step of ['glazed', 'ready_for_pickup']) {
          await client.query('insert into piece_history (piece_id, status, at) values ($1,$2,$3)', [
            piece.piece_id,
            step,
            at,
          ]);
        }
      }
      await client.query('delete from piece_open_load where piece_id = $1', [piece.piece_id]);
      if (outcome !== 'damaged') {
        const chargeId = newId();
        await client.query(
          `insert into charges (id, studio_id, piece_id, member_id, load_id, firing,
                                cubic_eighths, rate_cents, fee_cents, status, created_at,
                                claimed_until)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
          [
            chargeId,
            fresh.studio_id,
            piece.piece_id,
            piece.member_id,
            load.id,
            fresh.firing,
            piece.cubic_eighths,
            fresh.firing === 'bisque' ? piece.bisque_rate_cents : piece.glaze_rate_cents,
            fresh.firing === 'bisque' ? piece.bisque_fee_cents : piece.glaze_fee_cents,
            at,
            unloadClaim(at),
          ],
        );
        chargeIds.push(chargeId);
        await publish(client, {
          kind: 'charge',
          id: chargeId,
          studio_id: fresh.studio_id,
          member_id: piece.member_id,
        });
      }
      await publish(client, {
        kind: 'piece',
        id: piece.piece_id,
        studio_id: fresh.studio_id,
        member_id: piece.member_id,
      });
    }

    if (fresh.firing === 'glaze' && deadline) {
      const byMember = new Map<string, UnloadPieceRow[]>();
      for (const piece of pieces) {
        const bucket = byMember.get(piece.member_id) ?? [];
        bucket.push(piece);
        byMember.set(piece.member_id, bucket);
      }
      for (const bucket of byMember.values()) {
        const owner = bucket[0] as UnloadPieceRow;
        await queueEmail(
          client,
          fresh.studio_id,
          owner.member_email,
          `Ready for pickup at ${actor.studio.name}`,
          [
            `Your work is out of the ${fresh.kiln_name} and ready for pickup.`,
            ...bucket.map((piece) => `${piece.title} — Collect by ${formatStudioDate(deadline)}`),
          ].join('\n'),
        );
      }
    }
    await publishLoad(client, fresh);
    return { chargeIds };
  });

  // The unload created these charges already claimed, so no other instance's settler takes one
  // while this request settles it; whatever stays pending goes to the settler after.
  for (const chargeId of prepared.chargeIds) {
    const outcome = await settleCharge(chargeId, REQUEST_BUDGET_MS, true);
    if (outcome === 'pending') break;
  }
  await pool.query(
    `update charges set claimed_until = null where id = any($1::uuid[]) and status = 'pending'`,
    [prepared.chargeIds],
  );

  const refreshed = (await loadById(pool, load.studio_id, load.id)) as LoadRow;
  const charges = await rows<ChargeRow>(
    pool,
    `select ${CHARGE_COLUMNS} from charges c join pieces pc on pc.id = c.piece_id
      where c.load_id = $1 order by c.ordinal`,
    [load.id],
  );
  return {
    status: 200,
    body: { load: await loadBody(pool, refreshed), charges: charges.map(chargeBody) },
  };
}

export const loadRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/loads', role: 'staff', handle: createLoad },
  { method: 'GET', pattern: '/api/loads', role: 'staff', handle: listLoads },
  {
    method: 'GET',
    pattern: '/api/loads/:id',
    role: 'staff',
    resolve: resolveLoad,
    handle: async (ctx) => ({ status: 200, body: await loadBody(pool, heldLoad(ctx)) }),
  },
  {
    method: 'POST',
    pattern: '/api/loads/:id/decks',
    role: 'staff',
    resolve: resolveLoad,
    handle: addDeck,
  },
  {
    method: 'DELETE',
    pattern: '/api/loads/:id/decks/:number',
    role: 'staff',
    resolve: resolveLoad,
    handle: removeDeck,
  },
  {
    method: 'POST',
    pattern: '/api/loads/:id/placements',
    role: 'staff',
    resolve: resolveLoad,
    handle: placePiece,
  },
  {
    method: 'POST',
    pattern: '/api/loads/:id/moves',
    role: 'staff',
    resolve: resolveLoad,
    handle: movePlacement,
  },
  {
    method: 'DELETE',
    pattern: '/api/loads/:id/placements/:piece_id',
    role: 'staff',
    resolve: resolveLoad,
    handle: removePlacement,
  },
  {
    method: 'POST',
    pattern: '/api/loads/:id/status',
    role: 'staff',
    resolve: resolveLoad,
    handle: changeStatus,
  },
  {
    method: 'POST',
    pattern: '/api/loads/:id/unload',
    role: 'staff',
    idempotent: true,
    resolve: resolveLoad,
    handle: unload,
  },
];
