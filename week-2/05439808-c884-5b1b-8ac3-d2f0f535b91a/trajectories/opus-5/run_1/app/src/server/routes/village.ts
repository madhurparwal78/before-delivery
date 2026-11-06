import type { Queryable } from '../db.js';
import { takeLock } from '../db.js';
import { config } from '../config.js';
import { fail, notFound } from '../http/errors.js';
import {
  checkFields,
  FieldErrors,
  readIntegerQuery,
  parseBodyId
} from '../http/validate.js';
import { FIELD_MESSAGES } from '../../shared/messages.js';
import { publicRoute, sessionRoute, type Route } from '../http/route.js';
import {
  appliedSeconds,
  BUILDINGS,
  fitsBuildArea,
  levelBuildSeconds,
  levelCost,
  MAX_LEVEL,
  SALTMARK_FOR_LEVEL,
  UNITS
} from '../../shared/catalog.js';
import {
  BUILDING_TYPES,
  isBuildingType,
  isRotation,
  UNIT_KEYS,
  type BuildingType,
  type Rotation
} from '../../shared/types.js';
import { villageIdOf } from '../domain/accounts.js';
import { buildingView, ledgerEntryView, villageView } from '../domain/presenters.js';
import {
  activeRaidOnIsland,
  applyLapsedRaids
} from '../domain/raids.js';
import {
  buildDuration,
  buildersOf,
  canAfford,
  collectProducer,
  countOfType,
  creditCapped,
  findBuilding,
  loadIsland,
  overlapsAnything,
  saltmarkOf,
  spend,
  type Island
} from '../domain/village.js';
import { plusSeconds } from '../clock.js';

async function ownIsland(client: Queryable, accountId: number, at: Date): Promise<Island> {
  const villageId = await villageIdOf(client, accountId);
  if (villageId === null) notFound();
  await takeLock(client, 'village', villageId);
  await applyLapsedRaids(client, at);
  const island = await loadIsland(client, villageId, at);
  if (island === null) notFound();
  return island;
}

function readBuildingType(body: Record<string, unknown>, errors: FieldErrors): BuildingType {
  const raw = body.type;
  if (typeof raw === 'string' && isBuildingType(raw)) return raw;
  if (raw !== undefined) errors.add('type', FIELD_MESSAGES.type);
  return 'brine_pan';
}

function readPlacement(
  body: Record<string, unknown>,
  errors: FieldErrors,
  type: BuildingType
): { x: number; y: number; rotation: Rotation } {
  const rawX = body.x;
  const rawY = body.y;
  const rawRotation = body.rotation;
  const x = typeof rawX === 'number' && Number.isInteger(rawX) ? rawX : null;
  const y = typeof rawY === 'number' && Number.isInteger(rawY) ? rawY : null;
  if (x === null && rawX !== undefined) errors.add('x', FIELD_MESSAGES.coordinate);
  if (y === null && rawY !== undefined) errors.add('y', FIELD_MESSAGES.coordinate);
  const rotation = typeof rawRotation === 'number' && isRotation(rawRotation) ? rawRotation : null;
  if (rotation === null && rawRotation !== undefined) {
    errors.add('rotation', FIELD_MESSAGES.rotation);
  }
  if (errors.empty && x !== null && y !== null && rotation !== null) {
    if (!fitsBuildArea(type, x, y, rotation)) {
      errors.add('x', FIELD_MESSAGES.coordinate);
      errors.add('y', FIELD_MESSAGES.coordinate);
    }
  }
  errors.throwIfAny();
  return { x: x ?? 0, y: y ?? 0, rotation: rotation ?? 0 };
}

export const villageRoutes: Route[] = [
  publicRoute('GET', '/api/catalog', async () => ({
    status: 200,
    body: {
      buildings: BUILDING_TYPES.map((type) => {
        const spec = BUILDINGS[type];
        return {
          type,
          name: spec.name,
          width: spec.width,
          depth: spec.depth,
          maxCount: spec.maxCount,
          levels: spec.costs.map((cost, index) => ({
            level: index + 1,
            cost,
            buildSeconds: appliedSeconds(
              levelBuildSeconds(type, index + 1),
              config.buildTimeDivisor
            ),
            hitPoints: spec.hitPoints[index] ?? 0,
            saltmark: SALTMARK_FOR_LEVEL[index + 1] ?? 0
          })),
          producer: spec.producer ?? null,
          storage: spec.storage ?? null,
          housing: spec.housing ?? null,
          tower: spec.tower ?? null,
          trainsUnits: spec.trainsUnits === true
        };
      }),
      units: UNIT_KEYS.map((unit) => {
        const spec = UNITS[unit];
        return {
          unit,
          name: spec.name,
          housing: spec.housing,
          cost: spec.cost,
          trainSeconds: appliedSeconds(spec.trainSeconds, config.buildTimeDivisor),
          hitPoints: spec.hitPoints,
          damage: spec.damage,
          intervalTicks: spec.intervalTicks,
          rangeMilli: spec.rangeMilli,
          speedMilli: spec.speedMilli,
          barracksLevel: spec.barracksLevel
        };
      })
    }
  })),

  sessionRoute('GET', '/api/village', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    return {
      status: 200,
      body: villageView(island, ctx.account, await activeRaidOnIsland(client, island.villageId))
    };
  }),

  sessionRoute('GET', '/api/villages/:id', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    if (String(island.villageId) !== ctx.params.id) notFound();
    return {
      status: 200,
      body: villageView(island, ctx.account, await activeRaidOnIsland(client, island.villageId))
    };
  }),

  sessionRoute('POST', '/api/village/buildings', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const errors = new FieldErrors();
    checkFields(ctx.body, ['type', 'x', 'y', 'rotation'], ['type', 'x', 'y', 'rotation'], errors);
    const type = readBuildingType(ctx.body, errors);
    const placement = readPlacement(ctx.body, errors, type);

    if (overlapsAnything(island, { type, ...placement }, null)) fail('cell_occupied');
    if (countOfType(island, type) >= BUILDINGS[type].maxCount) fail('building_limit_reached');
    if (buildersOf(island).free < 1) fail('no_free_builder');
    const cost = levelCost(type, 1);
    if (!canAfford(island, cost)) fail('insufficient_resources');

    await spend(client, island, cost, 'build_spend');
    const finishesAt = plusSeconds(ctx.now, buildDuration(type, 1));
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO buildings
         (village_id, type, x, y, rotation, level, created_at, job_to_level, job_started_at, job_finishes_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, 1, $6, $7)
       RETURNING id`,
      [
        island.villageId,
        type,
        placement.x,
        placement.y,
        placement.rotation,
        ctx.now.toISOString(),
        finishesAt.toISOString()
      ]
    );
    const created = {
      id: Number(rows[0]?.id),
      type,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      level: 0,
      createdAt: ctx.now,
      jobToLevel: 1,
      jobStartedAt: ctx.now,
      jobFinishesAt: finishesAt,
      accrualStart: null
    };
    island.buildings.push(created);
    return { status: 201, body: buildingView(island, created) };
  }),

  sessionRoute('PATCH', '/api/village/buildings/:id', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const building = findBuilding(island, Number(ctx.params.id));
    if (building === null) notFound();
    const errors = new FieldErrors();
    checkFields(ctx.body, ['x', 'y', 'rotation'], ['x', 'y', 'rotation'], errors);
    const placement = readPlacement(ctx.body, errors, building.type);
    if (overlapsAnything(island, { type: building.type, ...placement }, building.id)) {
      fail('cell_occupied');
    }
    await client.query('UPDATE buildings SET x = $2, y = $3, rotation = $4 WHERE id = $1', [
      building.id,
      placement.x,
      placement.y,
      placement.rotation
    ]);
    building.x = placement.x;
    building.y = placement.y;
    building.rotation = placement.rotation;
    return { status: 200, body: buildingView(island, building) };
  }),

  sessionRoute('POST', '/api/village/buildings/:id/upgrade', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const building = findBuilding(island, Number(ctx.params.id));
    if (building === null) notFound();
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();

    if (building.jobToLevel !== null) fail('upgrade_in_progress');
    if (building.level >= MAX_LEVEL) fail('max_level');
    const toLevel = building.level + 1;
    const needed = SALTMARK_FOR_LEVEL[toLevel] ?? 0;
    if (saltmarkOf(island) < needed) fail('saltmark_too_low');
    if (buildersOf(island).free < 1) fail('no_free_builder');
    const cost = levelCost(building.type, toLevel);
    if (!canAfford(island, cost)) fail('insufficient_resources');

    if (BUILDINGS[building.type].producer) {
      await collectProducer(client, island, building, ctx.now);
    }
    await spend(client, island, cost, 'build_spend');
    const finishesAt = plusSeconds(ctx.now, buildDuration(building.type, toLevel));
    await client.query(
      `UPDATE buildings
         SET job_to_level = $2, job_started_at = $3, job_finishes_at = $4, accrual_start = NULL
       WHERE id = $1`,
      [building.id, toLevel, ctx.now.toISOString(), finishesAt.toISOString()]
    );
    building.jobToLevel = toLevel;
    building.jobStartedAt = ctx.now;
    building.jobFinishesAt = finishesAt;
    building.accrualStart = null;
    return { status: 200, body: buildingView(island, building) };
  }),

  sessionRoute('POST', '/api/village/buildings/:id/cancel', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const building = findBuilding(island, Number(ctx.params.id));
    if (building === null) notFound();
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    if (building.jobToLevel === null) fail('job_already_finished');

    const refund = levelCost(building.type, building.jobToLevel);
    const split = await creditCapped(client, island, refund, 'refund', ctx.now);
    const wasNew = building.jobToLevel === 1;
    if (wasNew) {
      await client.query('DELETE FROM buildings WHERE id = $1', [building.id]);
      island.buildings = island.buildings.filter((entry) => entry.id !== building.id);
      return {
        status: 200,
        body: { building: null, refunded: split.credited, lost: split.lost }
      };
    }
    await client.query(
      `UPDATE buildings
         SET job_to_level = NULL, job_started_at = NULL, job_finishes_at = NULL,
             accrual_start = CASE WHEN $2 THEN $3 ELSE accrual_start END
       WHERE id = $1`,
      [building.id, BUILDINGS[building.type].producer !== undefined, ctx.now.toISOString()]
    );
    building.jobToLevel = null;
    building.jobStartedAt = null;
    building.jobFinishesAt = null;
    if (BUILDINGS[building.type].producer) building.accrualStart = ctx.now;
    return {
      status: 200,
      body: {
        building: buildingView(island, building),
        refunded: split.credited,
        lost: split.lost
      }
    };
  }),

  sessionRoute('POST', '/api/village/buildings/:id/collect', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const building = findBuilding(island, Number(ctx.params.id));
    if (building === null) notFound();
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    if (!BUILDINGS[building.type].producer) fail('not_a_producer');
    const split = await collectProducer(client, island, building, ctx.now);
    return { status: 200, body: { collected: split.credited, lost: split.lost } };
  }),

  sessionRoute('GET', '/api/village/ledger', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const errors = new FieldErrors();
    const limitRaw = ctx.query.get('limit');
    const limit = limitRaw === null ? 50 : readIntegerQuery(limitRaw, { min: 1, max: 100 });
    if (limit === null) errors.add('limit', FIELD_MESSAGES.limit);
    const beforeRaw = ctx.query.get('before');
    const before = beforeRaw === null ? null : parseBodyId(beforeRaw);
    if (beforeRaw !== null && before === null) errors.add('before', FIELD_MESSAGES.cursor);
    errors.throwIfAny();
    const { rows } = await client.query<{
      id: number;
      pair_id: number;
      kind: string;
      asset: string;
      amount: number;
      counterparty_village_id: number | null;
      counterparty_display_name: string | null;
      raid_id: number | null;
      created_at: Date;
    }>(
      `SELECT e.id, e.pair_id, e.kind, e.asset, e.amount, e.counterparty_village_id,
              a.display_name AS counterparty_display_name, e.raid_id, e.created_at
         FROM ledger_entries e
         LEFT JOIN villages v ON v.id = e.counterparty_village_id
         LEFT JOIN accounts a ON a.id = v.account_id
        WHERE e.village_id = $1 AND ($2::bigint IS NULL OR e.id < $2)
        ORDER BY e.id DESC
        LIMIT $3`,
      [island.villageId, before, limit ?? 50]
    );
    return { status: 200, body: { entries: rows.map(ledgerEntryView) } };
  })
];
