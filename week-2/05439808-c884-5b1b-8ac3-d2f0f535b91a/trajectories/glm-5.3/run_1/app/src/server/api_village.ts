// The islander's own island: building placement, moves, upgrades, cancels, collection, the
// ledger read, and army training.
import { errors } from './errors.ts';
import { pathId, route, type Ctx } from './http.ts';
import { withTransaction } from './runtime.ts';
import { creditCapped, debitExact, balancesOf } from './ledger.ts';
import {
  buildingJson, loadIsland, lockVillage, uncollectedOf, villageJson, type BuildingRow, type IslandState,
} from './island.ts';
import { BUILDINGS, UNITS, levelCost, SALTMARK_THRESHOLDS, footprintAt } from '../domain/catalog.ts';
import type { BuildingType, ResourceAmounts, UnitKey } from '../domain/types.ts';
import { BUILD_MIN, BUILD_MAX, MAX_ID } from '../domain/types.ts';
import {
  exactFields, optionalCount, requireObject, requiredString, throwIfErrors, unitOf, isBuildingType, parseBodyId,
} from './validate.ts';

function requireVillageId(ctx: Ctx): number {
  if (ctx.account!.villageId === null) throw errors.notFound();
  return ctx.account!.villageId;
}

const AREA_MESSAGE = 'Keep the whole building inside the build area.';
const ROTATION_MESSAGE = 'Use 0, 90, 180 or 270.';
const COUNT_TRAIN_MESSAGE = 'Choose 1 to 20.';

function footprintInArea(type: BuildingType, x: number, y: number, rotation: number): { x: boolean; y: boolean } {
  const { width, depth } = footprintAt(type, rotation);
  const maxX = x + width - 1;
  const maxY = y + depth - 1;
  return { x: x >= BUILD_MIN && maxX <= BUILD_MAX, y: y >= BUILD_MIN && maxY <= BUILD_MAX };
}

function validRotation(value: unknown): value is number {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function parseCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

// The island state, read for the response after a change committed.
async function stateAfter(ctx: Ctx): Promise<IslandState> {
  const villageId = requireVillageId(ctx);
  const state = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    return loadIsland(client, villageId, ctx.now);
  });
  if (!state) throw errors.notFound();
  return state;
}

route('GET', '/api/village', 'session', async (ctx) => {
  const state = await stateAfter(ctx);
  return { status: 200, body: villageJson(state, ctx.account!.displayName, ctx.now) };
});

route('GET', '/api/villages/:id', 'session', async (ctx) => {
  const id = pathId(ctx, 'id');
  if (ctx.account!.villageId !== id) throw errors.notFound();
  const state = await stateAfter(ctx);
  return { status: 200, body: villageJson(state, ctx.account!.displayName, ctx.now) };
});

route('POST', '/api/village/buildings', 'session', async (ctx) => {
  const app = (await import('./runtime.ts')).getApp();
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['type', 'x', 'y', 'rotation']);
  const typeValue = requiredString(body, fieldErrors, 'type');
  let type: BuildingType | null = null;
  if (!fieldErrors.type) {
    if (!isBuildingType(typeValue)) fieldErrors.type = 'Choose a building from the catalog.';
    else type = typeValue;
  }
  const x = parseCoordinate(body.x);
  const y = parseCoordinate(body.y);
  let rotation: number | null = null;
  if (validRotation(body.rotation)) rotation = body.rotation as number;
  if (type && x !== null && y !== null) {
    const area = footprintInArea(type, x, y, rotation ?? 0);
    if (!area.x) fieldErrors.x = AREA_MESSAGE;
    if (!area.y) fieldErrors.y = AREA_MESSAGE;
  }
  if (rotation === null) fieldErrors.rotation = ROTATION_MESSAGE;
  throwIfErrors(fieldErrors);

  const villageId = requireVillageId(ctx);
  const created = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);

    const { width, depth } = footprintAt(type!, rotation!);
    const occupied = state.buildings.some((b) => x! < b.x + footprintAt(b.type, b.rotation).width && b.x < x! + width && y! < b.y + footprintAt(b.type, b.rotation).depth && b.y < y! + depth);
    if (occupied) throw errors.conflict('cell_occupied', 'That spot is taken.');
    const count = state.buildings.filter((b) => b.type === type!).length;
    if (count >= BUILDINGS[type!].maxCount) throw errors.conflict('building_limit_reached', 'Your island already holds the most of these.');
    if (state.builders.free <= 0) throw errors.conflict('no_free_builder', 'All builders are busy.');
    const cost = levelCost(type!, 1);
    if (!(await debitExact(client, villageId, 'build_spend', cost, state.balances, ctx.now))) {
      throw errors.conflict('insufficient_resources', 'Not enough resources for that.');
    }
    const finishes = ctx.now + Math.max(1, Math.ceil(BUILDINGS[type!].levels[0].buildSeconds / app.env.buildTimeDivisor)) * 1000;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO buildings (village_id, type, x, y, rotation, level, created_at, job_to_level, job_started_at, job_finishes_at,
       job_cost_brine, job_cost_peat, job_cost_copper, accrual_started_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, 1, $6, $7, $8, $9, $10, $6) RETURNING id`,
      [villageId, type, x, y, rotation, ctx.now, finishes, cost.brine, cost.peat, cost.copper]
    );
    return Number(inserted.rows[0].id);
  });
  if (created === null) throw errors.notFound();

  const state = await stateAfter(ctx);
  const building = state.buildings.find((b) => b.id === created);
  return { status: 201, body: buildingJson(building!, ctx.now) };
});

route('PATCH', '/api/village/buildings/:id', 'session', async (ctx) => {
  const id = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['x', 'y', 'rotation']);
  const x = parseCoordinate(body.x);
  const y = parseCoordinate(body.y);
  let rotation: number | null = null;
  if (validRotation(body.rotation)) rotation = body.rotation as number;
  if (x === null) fieldErrors.x = AREA_MESSAGE;
  if (y === null) fieldErrors.y = AREA_MESSAGE;
  if (rotation === null) fieldErrors.rotation = ROTATION_MESSAGE;
  throwIfErrors(fieldErrors);

  const villageId = requireVillageId(ctx);
  const moved = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);
    const building = state.buildings.find((b) => b.id === id);
    if (!building) return 'missing';

    const { width, depth } = footprintAt(building.type, rotation!);
    const occupied = state.buildings.some((b) => b.id !== building.id && x! < b.x + footprintAt(b.type, b.rotation).width && b.x < x! + width && y! < b.y + footprintAt(b.type, b.rotation).depth && b.y < y! + depth);
    if (occupied) throw errors.conflict('cell_occupied', 'That spot is taken.');
    await client.query('UPDATE buildings SET x = $2, y = $3, rotation = $4 WHERE id = $1', [id, x, y, rotation]);
    return 'ok';
  });
  if (moved === null || moved === 'missing') throw errors.notFound();

  const state = await stateAfter(ctx);
  const building = state.buildings.find((b) => b.id === id);
  return { status: 200, body: buildingJson(building!, ctx.now) };
});

route('POST', '/api/village/buildings/:id/upgrade', 'session', async (ctx) => {
  const app = (await import('./runtime.ts')).getApp();
  const id = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const villageId = requireVillageId(ctx);
  const outcome = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);
    const building = state.buildings.find((b) => b.id === id);
    if (!building) return 'missing';

    if (building.job_finishes_at !== null) throw errors.conflict('upgrade_in_progress', 'A builder is already on it.');
    if (building.level >= 3) throw errors.conflict('max_level', 'Already at the highest level.');
    const toLevel = building.level + 1;
    if (state.saltmark < (SALTMARK_THRESHOLDS[toLevel] ?? 0)) {
      throw errors.conflict('saltmark_too_low', 'Raise your island’s saltmark first — finish more building levels.');
    }
    if (state.builders.free <= 0) throw errors.conflict('no_free_builder', 'All builders are busy.');
    const cost = levelCost(building.type, toLevel);
    if (!(await debitExact(client, villageId, 'build_spend', cost, state.balances, ctx.now))) {
      throw errors.conflict('insufficient_resources', 'Not enough resources for that.');
    }
    const seconds = Math.max(1, Math.ceil(BUILDINGS[building.type].levels[toLevel - 1].buildSeconds / app.env.buildTimeDivisor));
    const finishes = ctx.now + seconds * 1000;

    // Starting an upgrade on a producer first collects it.
    if (BUILDINGS[building.type].producer) {
      const amount = uncollectedOf(building, ctx.now);
      if (amount > 0) {
        const producer = BUILDINGS[building.type].producer!;
        const amounts: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
        amounts[producer.resource] = amount;
        await creditCapped(client, villageId, 'production', amounts, state.balances, state.caps, ctx.now);
      }
    }
    await client.query(
      `UPDATE buildings SET job_to_level = $2, job_started_at = $3, job_finishes_at = $4,
       job_cost_brine = $5, job_cost_peat = $6, job_cost_copper = $7, accrual_started_at = $8 WHERE id = $1`,
      [id, toLevel, ctx.now, finishes, cost.brine, cost.peat, cost.copper, BUILDINGS[building.type].producer ? ctx.now : building.accrual_started_at]
    );
    return 'ok';
  });
  if (outcome === null || outcome === 'missing') throw errors.notFound();

  const state = await stateAfter(ctx);
  return { status: 200, body: buildingJson(state.buildings.find((b) => b.id === id)!, ctx.now) };
});

route('POST', '/api/village/buildings/:id/cancel', 'session', async (ctx) => {
  const id = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const villageId = requireVillageId(ctx);
  const outcome = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);
    const building = state.buildings.find((b) => b.id === id);
    if (!building) return 'missing';

    // applyCompleted has already finished any job whose time passed, so any job still running
    // is one whose finish time is strictly after this instant.
    if (building.job_finishes_at === null) throw errors.conflict('job_already_finished', 'That job already finished. Nothing was refunded.');

    const refund: ResourceAmounts = { brine: building.job_cost_brine, peat: building.job_cost_peat, copper: building.job_cost_copper };
    const { credited, lost } = await creditCapped(client, villageId, 'refund', refund, state.balances, state.caps, ctx.now);
    const wasConstruction = building.job_to_level === 1 && building.level === 0;
    if (wasConstruction) {
      await client.query('DELETE FROM buildings WHERE id = $1', [id]);
    } else {
      await client.query(
        `UPDATE buildings SET job_to_level = NULL, job_started_at = NULL, job_finishes_at = NULL,
         job_cost_brine = 0, job_cost_peat = 0, job_cost_copper = 0 WHERE id = $1`,
        [id]
      );
    }
    return { building: wasConstruction ? null : id, credited, lost };
  });
  if (outcome === null || outcome === 'missing') throw errors.notFound();

  let buildingJsonResult: Record<string, unknown> | null = null;
  if (outcome.building !== null) {
    const state = await stateAfter(ctx);
    buildingJsonResult = buildingJson(state.buildings.find((b) => b.id === outcome.building)!, ctx.now);
  }
  return { status: 200, body: { building: buildingJsonResult, refunded: outcome.credited, lost: outcome.lost } };
});

route('POST', '/api/village/buildings/:id/collect', 'session', async (ctx) => {
  const id = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const villageId = requireVillageId(ctx);
  const outcome = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);
    const building = state.buildings.find((b) => b.id === id);
    if (!building) return 'missing';
    if (!BUILDINGS[building.type].producer) throw errors.conflict('not_a_producer', 'Only producers can be collected.');

    const amount = uncollectedOf(building, ctx.now);
    const producer = BUILDINGS[building.type].producer!;
    const amounts: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
    amounts[producer.resource] = amount;
    const { credited, lost } = await creditCapped(client, villageId, 'production', amounts, state.balances, state.caps, ctx.now);
    await client.query('UPDATE buildings SET accrual_started_at = $2 WHERE id = $1', [id, ctx.now]);
    return { credited, lost };
  });
  if (outcome === null || outcome === 'missing') throw errors.notFound();
  return { status: 200, body: { collected: outcome.credited, lost: outcome.lost } };
});

route('GET', '/api/village/ledger', 'session', async (ctx) => {
  const villageId = requireVillageId(ctx);
  const fieldErrors: Record<string, string> = {};
  const limitRaw = ctx.query.get('limit');
  let limit = 50;
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 100) fieldErrors.limit = 'Use 1 to 100.';
    else limit = n;
  }
  const beforeRaw = ctx.query.get('before');
  let before: number | null = null;
  if (beforeRaw !== null) {
    const parsed = parseBodyId(beforeRaw);
    if (parsed === null) fieldErrors.before = 'Use an ID from this list.';
    else before = parsed;
  }
  throwIfErrors(fieldErrors);

      const entries = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    if (before !== null) {
      const hit = await client.query('SELECT id FROM ledger WHERE id = $1 AND village_id = $2', [before, villageId]);
      if (hit.rows.length === 0) return 'missing';
    }
    const params: unknown[] = [villageId];
    let sql = `SELECT l.*, a.display_name AS cp_name FROM ledger l
      LEFT JOIN villages v ON v.id = l.counterparty_village_id
      LEFT JOIN accounts a ON a.id = v.account_id
      WHERE l.village_id = $1`;
    if (before !== null) {
      params.push(before);
      sql += ` AND l.id < $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY l.id DESC LIMIT $${params.length}`;
    const rows = await client.query(sql, params);
    return rows.rows.map((row) => ({
      id: Number(row.id),
      pairId: Number(row.pair_id),
      kind: row.kind,
      asset: row.asset,
      amount: Number(row.amount),
      counterparty: row.counterparty_kind === 'tide' ? 'tide' : { villageId: Number(row.counterparty_village_id), displayName: row.cp_name },
      raidId: row.raid_id === null ? null : Number(row.raid_id),
      createdAt: new Date(Number(row.created_at)).toISOString(),
    }));
  });
  if (entries === null) throw errors.notFound();
  if (entries === 'missing') throw errors.notFound();
  return { status: 200, body: { entries } };
});

// --- army ---

function armyOf(state: IslandState): Record<string, unknown> {
  return {
    units: { saltjack: state.balances.saltjack, peat_slinger: state.balances.peat_slinger },
    training: state.training.map((t) => ({
      id: t.id,
      unit: t.unit,
      count: t.count,
      startsAt: new Date(t.starts_at).toISOString(),
      finishesAt: new Date(t.finishes_at).toISOString(),
    })),
    housing: state.housing,
  };
}

route('GET', '/api/army', 'session', async (ctx) => {
  const state = await stateAfter(ctx);
  return { status: 200, body: { army: armyOf(state) } };
});

route('POST', '/api/army/train', 'session', async (ctx) => {
  const app = (await import('./runtime.ts')).getApp();
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['unit', 'count']);
  const unit = unitOf(body, fieldErrors);
  const count = optionalCount(body, fieldErrors, 'count', COUNT_TRAIN_MESSAGE);
  if (!fieldErrors.count && (count < 1 || count > 20)) fieldErrors.count = COUNT_TRAIN_MESSAGE;
  throwIfErrors(fieldErrors);

  const villageId = requireVillageId(ctx);
  const outcome = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);

    const barracks = state.buildings.find((b) => b.type === 'tide_barracks' && b.level >= 1);
    if (!barracks) throw errors.conflict('barracks_required', 'Build a Tide Barracks first.');
    if (unit === 'peat_slinger' && barracks.level < 2) throw errors.conflict('barracks_level_too_low', 'Upgrade your Tide Barracks first.');
    if (state.housing.used + count > state.housing.capacity) throw errors.conflict('housing_full', 'Your camps are full.');

    const cost: ResourceAmounts = { brine: UNITS[unit].cost.brine * count, peat: 0, copper: 0 };
    if (!(await debitExact(client, villageId, 'train_spend', cost, state.balances, ctx.now))) {
      throw errors.conflict('insufficient_resources', 'Not enough resources for that.');
    }
    const unitSeconds = Math.max(1, Math.ceil(UNITS[unit].trainSeconds / app.env.buildTimeDivisor));
    const duration = count * unitSeconds * 1000;
    const last = state.training.length > 0 ? state.training[state.training.length - 1] : null;
    const startsAt = Math.max(ctx.now, last ? last.finishes_at : ctx.now);
    const finishesAt = startsAt + duration;
    await client.query(
      'INSERT INTO training_batches (village_id, unit, count, starts_at, finishes_at, queued_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [villageId, unit, count, startsAt, finishesAt, ctx.now, 'queued']
    );
    return 'ok';
  });
  if (outcome === null) throw errors.notFound();

  const state = await stateAfter(ctx);
  return { status: 201, body: { army: armyOf(state) } };
});

route('POST', '/api/army/training/:id/cancel', 'session', async (ctx) => {
  const app = (await import('./runtime.ts')).getApp();
  const id = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const villageId = requireVillageId(ctx);
  const outcome = await withTransaction(async (client) => {
    const village = await lockVillage(client, villageId);
    if (!village) return null;
    const state = await loadIsland(client, villageId, ctx.now);
    const batch = state.training.find((t) => t.id === id);
    if (!batch) {
      const existing = await client.query('SELECT status FROM training_batches WHERE id = $1 AND village_id = $2', [id, villageId]);
      if (existing.rows.length === 0) return 'missing';
      // finished batches answer batch_already_finished; cancelled ones are gone from the queue
      if (existing.rows[0].status === 'finished') throw errors.conflict('batch_already_finished', 'That training already finished. Nothing was refunded.');
      return 'missing';
    }

    const unit = batch.unit as UnitKey;
    const refund: ResourceAmounts = { brine: UNITS[unit].cost.brine * batch.count, peat: 0, copper: 0 };
    const { credited, lost } = await creditCapped(client, villageId, 'refund', refund, state.balances, state.caps, ctx.now);
    await client.query('UPDATE training_batches SET status = $3 WHERE id = $1 AND village_id = $2', [id, villageId, 'cancelled']);

    // Recompute the queue schedule: the running batch keeps its start; later ones follow in order.
    let cursor = ctx.now;
    const remaining = state.training.filter((t) => t.id !== id);
    for (const t of remaining) {
      const wasRunning = t.starts_at <= ctx.now;
      const tUnitSeconds = Math.max(1, Math.ceil(UNITS[t.unit].trainSeconds / app.env.buildTimeDivisor));
      const duration = t.count * tUnitSeconds * 1000;
      if (wasRunning) {
        cursor = t.finishes_at;
        continue;
      }
      const startsAt = Math.max(ctx.now, cursor);
      const finishesAt = startsAt + duration;
      await client.query('UPDATE training_batches SET starts_at = $2, finishes_at = $3 WHERE id = $1', [t.id, startsAt, finishesAt]);
      cursor = finishesAt;
    }
    return { credited, lost };
  });
  if (outcome === null || outcome === 'missing') throw errors.notFound();

  const state = await stateAfter(ctx);
  return { status: 200, body: { army: armyOf(state), refunded: outcome.credited, lost: outcome.lost } };
});
