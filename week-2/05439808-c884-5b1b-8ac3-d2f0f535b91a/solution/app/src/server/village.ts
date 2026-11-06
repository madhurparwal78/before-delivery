// Village, building, ledger and army routes. The browser sends intents; the server decides the rest.
import {
  appliedSeconds, BUILDING_TYPES, BUILDINGS, isBuildingType, isRotation, isUnitKey, levelCost, MAX_LEVEL,
  RESOURCES, saltmarkThreshold, UNIT_KEYS, UNITS, zeroAmounts, type Amounts, type BuildingType, type Rotation,
} from '../shared/catalog';
import { footprint, insideBuildArea, occupied } from '../shared/grid';
import { leagueFor } from './accounts';
import { iso, now } from './clock';
import { config } from './config';
import { tx, type Db } from './db';
import { fail } from './errors';
import { parseId, publicRoute, sessionRoute, type Account, type SignedInCtx } from './http';
import {
  affordable, armyView, buildingView, builders, creditCapped, housing, isShielded, jobMs, lockIsland,
  resourceView, saltmark, scheduleBatches, spend, uncollected, batchMs, type BuildingRow, type Island,
} from './island';
import { abandonOverdueRaids, underAttack } from './raids';
import { Fields, intIn, isInteger, MESSAGES, rejectField } from './validate';

export async function villageIdOf(db: Db, accountId: number): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM villages WHERE account_id = $1', [accountId]);
  return rows[0]?.id ?? null;
}

/** Opens the caller's own island under its lock, brought up to now. Operators have none. */
export async function ownIsland(db: Db, account: Account, at: number): Promise<Island> {
  const villageId = await villageIdOf(db, account.id);
  if (villageId === null) return fail('not_found');
  await abandonOverdueRaids(db, at);
  return lockIsland(db, villageId, at);
}

export async function villageView(db: Db, island: Island, at: number): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ display_name: string; trophies: number }>('SELECT display_name, trophies FROM accounts WHERE id = $1', [island.accountId]);
  const owner = rows[0] as { display_name: string; trophies: number };
  return {
    id: island.villageId,
    displayName: owner.display_name,
    grid: { width: 40, height: 40 },
    buildings: island.buildings.map((b) => buildingView(b, at)),
    resources: resourceView(island),
    saltmark: saltmark(island.buildings),
    builders: builders(island.buildings),
    army: armyView(island),
    shield: isShielded(island, at) ? { endsAt: iso(island.shieldEnd as number) } : null,
    underAttack: await underAttack(db, island.villageId),
    trophies: owner.trophies,
    league: leagueFor(owner.trophies),
    serverTime: iso(at),
  };
}

function ownBuilding(island: Island, id: number): BuildingRow {
  return island.buildings.find((b) => b.id === id) ?? fail('not_found');
}

/** Validates x, y and rotation for a footprint; out-of-area answers on the axis that overflows. */
function takePlacement(f: Fields, type: BuildingType | undefined): { x: number; y: number; rotation: Rotation } | null {
  const x = f.take('x', isInteger, MESSAGES.cell);
  const y = f.take('y', isInteger, MESSAGES.cell);
  const rotation = f.take('rotation', isRotation, MESSAGES.rotation);
  if (type === undefined || x === undefined || y === undefined || rotation === undefined) return null;
  const fp = footprint(type, x, y, rotation);
  if (!insideBuildArea(fp)) {
    const xOk = insideBuildArea({ ...fp, y: 2, depth: 1 });
    const yOk = insideBuildArea({ ...fp, x: 2, width: 1 });
    if (!xOk) f.fail('x', MESSAGES.cell);
    if (!yOk) f.fail('y', MESSAGES.cell);
    return null;
  }
  return { x, y, rotation };
}

async function collect(db: Db, island: Island, b: BuildingRow, at: number): Promise<{ collected: Amounts; lost: Amounts }> {
  const resource = BUILDINGS[b.type].producer?.resource;
  const collected = zeroAmounts();
  const lost = zeroAmounts();
  if (resource !== undefined) {
    const output = uncollected(b, at);
    const amounts = zeroAmounts();
    amounts[resource] = output;
    const landed = await creditCapped(db, island, amounts, 'production', at);
    collected[resource] = landed.credited[resource];
    lost[resource] = landed.lost[resource];
  }
  b.accrual_start = at;
  await db.query('UPDATE buildings SET accrual_start = $2 WHERE id = $1', [b.id, at]);
  return { collected, lost };
}

publicRoute('GET', '/api/catalog', async () => ({
  status: 200,
  body: {
    buildings: BUILDING_TYPES.map((type) => {
      const spec = BUILDINGS[type];
      return {
        type, name: spec.name, footprint: { width: spec.width, depth: spec.depth }, maxCount: spec.maxCount,
        levels: [1, 2, 3].map((level) => ({
          level,
          cost: levelCost(type, level),
          buildSeconds: appliedSeconds(spec.buildSeconds[level - 1] as number, config.buildTimeDivisor),
          hp: spec.hp[level - 1],
          saltmarkRequired: saltmarkThreshold(level),
          ...(spec.producer ? { produces: spec.producer.resource, perHour: spec.producer.perHour[level - 1], buffer: spec.producer.buffer[level - 1] } : {}),
          ...(spec.storage ? { stores: spec.storage.resource, capBonus: spec.storage.cap[level - 1] } : {}),
          ...(spec.housing ? { housing: spec.housing[level - 1] } : {}),
          ...(spec.tower ? { damage: spec.tower.damage[level - 1], rangeCells: spec.tower.rangeMilli / 1000, firesEveryTicks: spec.tower.interval } : {}),
        })),
      };
    }),
    units: UNIT_KEYS.map((key) => {
      const u = UNITS[key];
      return {
        key, name: u.name, housing: u.housing, cost: u.cost, trainSeconds: appliedSeconds(u.trainSeconds, config.buildTimeDivisor),
        hp: u.hp, damage: u.damage, attacksEveryTicks: u.interval, rangeCells: u.rangeMilli / 1000, cellsPerTick: u.speedMilli / 1000,
        barracksLevel: u.barracksLevel,
      };
    }),
  },
}));

const readVillage = async (ctx: SignedInCtx): Promise<Record<string, unknown>> =>
  tx(async (db) => {
    const at = now();
    return villageView(db, await ownIsland(db, ctx.account, at), at);
  });

sessionRoute('GET', '/api/village', async (ctx) => ({ status: 200, body: await readVillage(ctx) }));

sessionRoute('GET', '/api/villages/:id', async (ctx) => {
  const own = await tx((db) => villageIdOf(db, ctx.account.id));
  if (own !== ctx.params.id) fail('not_found');
  return { status: 200, body: await readVillage(ctx) };
});

sessionRoute('POST', '/api/village/buildings', async (ctx) => {
  const f = new Fields(ctx.body, ['type', 'x', 'y', 'rotation']);
  const type = f.take('type', isBuildingType, MESSAGES.type);
  const spot = takePlacement(f, type);
  f.done();
  const { x, y, rotation } = spot as { x: number; y: number; rotation: Rotation };
  const kind = type as BuildingType;
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    if (occupied(island.buildings, footprint(kind, x, y, rotation), null)) fail('cell_occupied');
    if (island.buildings.filter((b) => b.type === kind).length >= BUILDINGS[kind].maxCount) fail('building_limit_reached');
    if (builders(island.buildings).free < 1) fail('no_free_builder');
    const cost = levelCost(kind, 1);
    if (!affordable(island, cost)) fail('insufficient_resources');
    await spend(db, island, cost, 'build_spend', at);
    const { rows } = await db.query<BuildingRow>(
      `INSERT INTO buildings (village_id, type, x, y, rotation, level, job_to_level, job_started_at, job_finishes_at, job_cost, accrual_start, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, 1, $6, $7, $8, $6, $6) RETURNING *`,
      [island.villageId, kind, x, y, rotation, at, at + jobMs(kind, 1), JSON.stringify(cost)],
    );
    return buildingView(rows[0] as BuildingRow, at);
  });
  return { status: 201, body };
});

sessionRoute('PATCH', '/api/village/buildings/:id', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    const b = ownBuilding(island, ctx.params.id as number);
    const f = new Fields(ctx.body, ['x', 'y', 'rotation']);
    const spot = takePlacement(f, b.type);
    f.done();
    const { x, y, rotation } = spot as { x: number; y: number; rotation: Rotation };
    if (occupied(island.buildings, footprint(b.type, x, y, rotation), b.id)) fail('cell_occupied');
    await db.query('UPDATE buildings SET x = $2, y = $3, rotation = $4 WHERE id = $1', [b.id, x, y, rotation]);
    return buildingView({ ...b, x, y, rotation }, at);
  });
  return { status: 200, body };
});

sessionRoute('POST', '/api/village/buildings/:id/upgrade', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    const b = ownBuilding(island, ctx.params.id as number);
    new Fields(ctx.body, []).done();
    if (b.job_to_level !== null) fail('upgrade_in_progress');
    if (b.level >= MAX_LEVEL) fail('max_level');
    const target = b.level + 1;
    if (saltmark(island.buildings) < saltmarkThreshold(target)) fail('saltmark_too_low');
    if (builders(island.buildings).free < 1) fail('no_free_builder');
    if (BUILDINGS[b.type].producer) await collect(db, island, b, at);
    const cost = levelCost(b.type, target);
    if (!affordable(island, cost)) fail('insufficient_resources');
    await spend(db, island, cost, 'build_spend', at);
    const job = { job_to_level: target, job_started_at: at, job_finishes_at: at + jobMs(b.type, target), job_cost: cost };
    await db.query(
      'UPDATE buildings SET job_to_level = $2, job_started_at = $3, job_finishes_at = $4, job_cost = $5 WHERE id = $1',
      [b.id, job.job_to_level, job.job_started_at, job.job_finishes_at, JSON.stringify(cost)],
    );
    return buildingView({ ...b, ...job }, at);
  });
  return { status: 200, body };
});

sessionRoute('POST', '/api/village/buildings/:id/cancel', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    const b = ownBuilding(island, ctx.params.id as number);
    new Fields(ctx.body, []).done();
    if (b.job_to_level === null) fail('job_already_finished');
    const { credited, lost } = await creditCapped(db, island, b.job_cost as Amounts, 'refund', at);
    if (b.level === 0) {
      await db.query('DELETE FROM buildings WHERE id = $1', [b.id]);
      return { building: null, refunded: credited, lost };
    }
    await db.query(
      'UPDATE buildings SET job_to_level = NULL, job_started_at = NULL, job_finishes_at = NULL, job_cost = NULL, accrual_start = $2 WHERE id = $1',
      [b.id, at],
    );
    const kept: BuildingRow = { ...b, job_to_level: null, job_started_at: null, job_finishes_at: null, job_cost: null, accrual_start: at };
    return { building: buildingView(kept, at), refunded: credited, lost };
  });
  return { status: 200, body };
});

sessionRoute('POST', '/api/village/buildings/:id/collect', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    const b = ownBuilding(island, ctx.params.id as number);
    new Fields(ctx.body, []).done();
    if (!BUILDINGS[b.type].producer) fail('not_a_producer');
    return collect(db, island, b, at);
  });
  return { status: 200, body };
});

interface LedgerRow {
  id: number;
  pair_id: number;
  kind: string;
  asset: string;
  amount: number;
  counterparty_village_id: number | null;
  counterparty_name: string | null;
  raid_id: number | null;
  created_at: number;
}

sessionRoute('GET', '/api/village/ledger', async (ctx) => {
  const limitRaw = ctx.query.get('limit');
  const beforeRaw = ctx.query.get('before');
  const limit = limitRaw === null ? 50 : /^[0-9]{1,3}$/.test(limitRaw) ? Number(limitRaw) : NaN;
  if (!(limit >= 1 && limit <= 100)) rejectField('limit', MESSAGES.limit);
  const before = beforeRaw === null ? null : parseId(beforeRaw);
  if (beforeRaw !== null && before === null) rejectField('before', MESSAGES.listId);
  const entries = await tx(async (db) => {
    const villageId = await villageIdOf(db, ctx.account.id);
    if (villageId === null) return fail('not_found');
    if (before !== null) {
      const known = await db.query('SELECT 1 FROM ledger_entries WHERE id = $1 AND village_id = $2', [before, villageId]);
      if (known.rowCount === 0) fail('not_found');
    }
    const { rows } = await db.query<LedgerRow>(
      `SELECT e.id, e.pair_id, e.kind, e.asset, e.amount, e.counterparty_village_id, e.raid_id, e.created_at, a.display_name AS counterparty_name
         FROM ledger_entries e
         LEFT JOIN villages v ON v.id = e.counterparty_village_id
         LEFT JOIN accounts a ON a.id = v.account_id
        WHERE e.village_id = $1 AND ($2::bigint IS NULL OR e.id < $2)
        ORDER BY e.id DESC LIMIT $3`,
      [villageId, before, limit],
    );
    return rows.map((r) => ({
      id: r.id, pairId: r.pair_id, kind: r.kind, asset: r.asset, amount: r.amount,
      counterparty: r.counterparty_village_id === null ? 'tide' : { villageId: r.counterparty_village_id, displayName: r.counterparty_name },
      raidId: r.raid_id, createdAt: iso(r.created_at),
    }));
  });
  return { status: 200, body: { entries } };
});

sessionRoute('GET', '/api/army', async (ctx) => {
  const army = await tx(async (db) => armyView(await ownIsland(db, ctx.account, now())));
  return { status: 200, body: { army } };
});

sessionRoute('POST', '/api/army/train', async (ctx) => {
  const f = new Fields(ctx.body, ['unit', 'count']);
  const unit = f.take('unit', isUnitKey, MESSAGES.unit);
  const count = f.take('count', intIn(1, 20), MESSAGES.trainCount);
  f.done();
  const key = unit as (typeof UNIT_KEYS)[number];
  const size = count as number;
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    const barracks = island.buildings.find((b) => b.type === 'tide_barracks' && b.level > 0);
    if (!barracks) fail('barracks_required');
    if ((barracks as BuildingRow).level < UNITS[key].barracksLevel) fail('barracks_level_too_low');
    const room = housing(island);
    if (room.used + size * UNITS[key].housing > room.capacity) fail('housing_full');
    const cost = zeroAmounts();
    for (const r of RESOURCES) cost[r] = UNITS[key].cost[r] * size;
    if (!affordable(island, cost)) fail('insufficient_resources');
    await spend(db, island, cost, 'train_spend', at);
    const last = island.batches[island.batches.length - 1];
    const startsAt = last ? last.finishes_at : at;
    const finishesAt = startsAt + batchMs(key, size);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO training_batches (village_id, unit, count, cost, enqueued_at, starts_at, finishes_at, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued') RETURNING id`,
      [island.villageId, key, size, JSON.stringify(cost), at, startsAt, finishesAt],
    );
    island.batches.push({ id: (rows[0] as { id: number }).id, unit: key, count: size, cost, enqueued_at: at, starts_at: startsAt, finishes_at: finishesAt });
    return { army: armyView(island) };
  });
  return { status: 201, body };
});

sessionRoute('POST', '/api/army/training/:batchId/cancel', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    const { rows } = await db.query<{ state: string }>('SELECT state FROM training_batches WHERE id = $1 AND village_id = $2', [ctx.params.batchId, island.villageId]);
    const state = rows[0]?.state;
    if (state === undefined || state === 'cancelled') fail('not_found');
    new Fields(ctx.body, []).done();
    if (state === 'done') fail('batch_already_finished');
    const index = island.batches.findIndex((b) => b.id === ctx.params.batchId);
    const batch = island.batches[index] as Island['batches'][number];
    const running = index === 0 && batch.starts_at <= at;
    const headStart = running ? at : (island.batches[0] as Island['batches'][number]).starts_at;
    island.batches.splice(index, 1);
    scheduleBatches(island.batches, headStart);
    await db.query("UPDATE training_batches SET state = 'cancelled' WHERE id = $1", [batch.id]);
    for (const b of island.batches) {
      await db.query('UPDATE training_batches SET starts_at = $2, finishes_at = $3 WHERE id = $1', [b.id, b.starts_at, b.finishes_at]);
    }
    const { credited, lost } = await creditCapped(db, island, batch.cost, 'refund', at);
    return { army: armyView(island), refunded: credited, lost };
  });
  return { status: 200, body };
});

