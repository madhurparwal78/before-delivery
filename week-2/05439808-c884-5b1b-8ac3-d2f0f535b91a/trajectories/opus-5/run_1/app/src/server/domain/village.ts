import type { Queryable } from '../db.js';
import { config } from '../config.js';
import {
  BASE_STORAGE,
  BUILDINGS,
  appliedSeconds,
  buildersTotal,
  footprintsOverlap,
  levelBuildSeconds,
  UNITS
} from '../../shared/catalog.js';
import type { BuildingType, ResourceAmounts, Rotation, UnitKey } from '../../shared/types.js';
import { RESOURCES } from '../../shared/types.js';
import { movePair, moveResources, readBalances, resourcesOf, totalUnits, unitsOf } from './ledger.js';
import type { Balances } from './ledger.js';

export type BuildingRow = {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  createdAt: Date;
  jobToLevel: number | null;
  jobStartedAt: Date | null;
  jobFinishesAt: Date | null;
  accrualStart: Date | null;
};

export type TrainingRow = {
  id: number;
  unit: UnitKey;
  count: number;
  startsAt: Date;
  finishesAt: Date;
};

export type Island = {
  villageId: number;
  accountId: number;
  createdAt: Date;
  shieldEndsAt: Date | null;
  buildings: BuildingRow[];
  training: TrainingRow[];
  balances: Balances;
  now: Date;
};

type BuildingDbRow = {
  id: number;
  type: string;
  x: number;
  y: number;
  rotation: number;
  level: number;
  created_at: Date;
  job_to_level: number | null;
  job_started_at: Date | null;
  job_finishes_at: Date | null;
  accrual_start: Date | null;
};

type BatchDbRow = {
  id: number;
  unit: string;
  count: number;
  starts_at: Date;
  finishes_at: Date;
};

function mapBuilding(row: BuildingDbRow): BuildingRow {
  return {
    id: Number(row.id),
    type: row.type as BuildingType,
    x: row.x,
    y: row.y,
    rotation: row.rotation as Rotation,
    level: row.level,
    createdAt: row.created_at,
    jobToLevel: row.job_to_level,
    jobStartedAt: row.job_started_at,
    jobFinishesAt: row.job_finishes_at,
    accrualStart: row.accrual_start
  };
}

export function buildDuration(type: BuildingType, level: number): number {
  return appliedSeconds(levelBuildSeconds(type, level), config.buildTimeDivisor);
}

export function trainDuration(unit: UnitKey, count: number): number {
  return appliedSeconds(UNITS[unit].trainSeconds, config.buildTimeDivisor) * count;
}

async function applyFinishedWork(
  client: Queryable,
  villageId: number,
  now: Date
): Promise<void> {
  const { rows: jobs } = await client.query<BuildingDbRow>(
    `SELECT * FROM buildings
      WHERE village_id = $1 AND job_finishes_at IS NOT NULL AND job_finishes_at <= $2
      ORDER BY job_finishes_at, id`,
    [villageId, now.toISOString()]
  );
  for (const job of jobs) {
    const isProducer = BUILDINGS[job.type as BuildingType].producer !== undefined;
    await client.query(
      `UPDATE buildings
         SET level = job_to_level,
             job_to_level = NULL,
             job_started_at = NULL,
             job_finishes_at = NULL,
             accrual_start = CASE WHEN $2 THEN job_finishes_at ELSE accrual_start END
       WHERE id = $1`,
      [job.id, isProducer]
    );
  }

  const { rows: batches } = await client.query<BatchDbRow>(
    `SELECT id, unit, count, starts_at, finishes_at FROM training_batches
      WHERE village_id = $1 AND applied = false AND cancelled_at IS NULL AND finishes_at <= $2
      ORDER BY finishes_at, id`,
    [villageId, now.toISOString()]
  );
  for (const batch of batches) {
    await client.query('UPDATE training_batches SET applied = true WHERE id = $1', [batch.id]);
    await movePair(client, {
      kind: 'train_complete',
      asset: batch.unit as UnitKey,
      amount: batch.count,
      fromVillageId: null,
      toVillageId: villageId,
      at: batch.finishes_at
    });
  }
}

export async function loadIsland(
  client: Queryable,
  villageId: number,
  now: Date
): Promise<Island | null> {
  const { rows } = await client.query<{
    id: number;
    account_id: number;
    created_at: Date;
    shield_ends_at: Date | null;
  }>('SELECT id, account_id, created_at, shield_ends_at FROM villages WHERE id = $1', [villageId]);
  const village = rows[0];
  if (!village) return null;
  await applyFinishedWork(client, villageId, now);
  const { rows: buildingRows } = await client.query<BuildingDbRow>(
    'SELECT * FROM buildings WHERE village_id = $1 ORDER BY created_at, id',
    [villageId]
  );
  const { rows: batchRows } = await client.query<BatchDbRow>(
    `SELECT id, unit, count, starts_at, finishes_at FROM training_batches
      WHERE village_id = $1 AND applied = false AND cancelled_at IS NULL
      ORDER BY id`,
    [villageId]
  );
  return {
    villageId: Number(village.id),
    accountId: Number(village.account_id),
    createdAt: village.created_at,
    shieldEndsAt: village.shield_ends_at,
    buildings: buildingRows.map(mapBuilding),
    training: batchRows.map((row) => ({
      id: Number(row.id),
      unit: row.unit as UnitKey,
      count: row.count,
      startsAt: row.starts_at,
      finishesAt: row.finishes_at
    })),
    balances: await readBalances(client, villageId),
    now
  };
}

export function saltmarkOf(island: Island): number {
  return island.buildings.reduce((total, building) => total + building.level, 0);
}

export function buildersOf(island: Island): { total: number; free: number } {
  const total = buildersTotal(saltmarkOf(island));
  const running = island.buildings.filter((building) => building.jobToLevel !== null).length;
  return { total, free: total - running };
}

export function storageCaps(island: Island): ResourceAmounts {
  const caps: ResourceAmounts = { ...BASE_STORAGE };
  for (const building of island.buildings) {
    const storage = BUILDINGS[building.type].storage;
    if (!storage || building.level < 1) continue;
    const effect = storage[building.level - 1];
    if (!effect) continue;
    caps[effect.resource] += effect.cap;
  }
  return caps;
}

export function housingCapacity(island: Island): number {
  let capacity = 0;
  for (const building of island.buildings) {
    const housing = BUILDINGS[building.type].housing;
    if (!housing || building.level < 1) continue;
    capacity += housing[building.level - 1] ?? 0;
  }
  return capacity;
}

export function housingUsed(island: Island): number {
  const inArmy = totalUnits(unitsOf(island.balances));
  const inQueue = island.training.reduce((total, batch) => total + batch.count, 0);
  return inArmy + inQueue;
}

export function uncollectedOf(island: Island, building: BuildingRow): ResourceAmounts {
  const producer = BUILDINGS[building.type].producer;
  const amounts: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
  if (!producer || building.level < 1 || building.jobToLevel !== null || !building.accrualStart) {
    return amounts;
  }
  const effect = producer[building.level - 1];
  if (!effect) return amounts;
  const elapsed = island.now.getTime() - building.accrualStart.getTime();
  const accrued = Math.floor((effect.perHour * Math.max(0, elapsed)) / 3_600_000);
  amounts[effect.resource] = Math.min(effect.buffer, accrued);
  return amounts;
}

export function storageRoom(island: Island): ResourceAmounts {
  const caps = storageCaps(island);
  const balances = resourcesOf(island.balances);
  return {
    brine: Math.max(0, caps.brine - balances.brine),
    peat: Math.max(0, caps.peat - balances.peat),
    copper: Math.max(0, caps.copper - balances.copper)
  };
}

function splitByRoom(
  island: Island,
  amounts: ResourceAmounts
): { credited: ResourceAmounts; lost: ResourceAmounts } {
  const room = storageRoom(island);
  const credited: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
  const lost: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
  for (const resource of RESOURCES) {
    const take = Math.min(amounts[resource], room[resource]);
    credited[resource] = take;
    lost[resource] = amounts[resource] - take;
  }
  return { credited, lost };
}

export function canAfford(island: Island, cost: ResourceAmounts): boolean {
  const balances = resourcesOf(island.balances);
  return RESOURCES.every((resource) => balances[resource] >= cost[resource]);
}

export async function spend(
  client: Queryable,
  island: Island,
  cost: ResourceAmounts,
  kind: 'build_spend' | 'train_spend'
): Promise<void> {
  await moveResources(
    client,
    { kind, fromVillageId: island.villageId, toVillageId: null, at: island.now },
    cost
  );
  for (const resource of RESOURCES) {
    island.balances[resource] -= cost[resource];
  }
}

export async function creditCapped(
  client: Queryable,
  island: Island,
  amounts: ResourceAmounts,
  kind: 'refund' | 'production' | 'daily_chest' | 'league_bonus' | 'star_bonus',
  at: Date
): Promise<{ credited: ResourceAmounts; lost: ResourceAmounts }> {
  const split = splitByRoom(island, amounts);
  await moveResources(
    client,
    { kind, fromVillageId: null, toVillageId: island.villageId, at },
    split.credited
  );
  for (const resource of RESOURCES) {
    island.balances[resource] += split.credited[resource];
  }
  return split;
}

export function overlapsAnything(
  island: Island,
  candidate: { type: BuildingType; x: number; y: number; rotation: Rotation },
  ignoreBuildingId: number | null
): boolean {
  return island.buildings.some(
    (building) => building.id !== ignoreBuildingId && footprintsOverlap(candidate, building)
  );
}

export function countOfType(island: Island, type: BuildingType): number {
  return island.buildings.filter((building) => building.type === type).length;
}

export function findBuilding(island: Island, buildingId: number): BuildingRow | null {
  return island.buildings.find((building) => building.id === buildingId) ?? null;
}

export async function createStarterIsland(
  client: Queryable,
  accountId: number,
  at: Date
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    'INSERT INTO villages (account_id, created_at) VALUES ($1, $2) RETURNING id',
    [accountId, at.toISOString()]
  );
  const villageId = Number(rows[0]?.id);
  const starter: { type: BuildingType; x: number; y: number }[] = [
    { type: 'tide_barracks', x: 12, y: 18 },
    { type: 'driftwood_camp', x: 25, y: 18 },
    { type: 'brine_pan', x: 12, y: 24 },
    { type: 'peat_cutter', x: 26, y: 24 },
    { type: 'kiln_tower', x: 18, y: 26 }
  ];
  for (const building of starter) {
    const isProducer = BUILDINGS[building.type].producer !== undefined;
    await client.query(
      `INSERT INTO buildings (village_id, type, x, y, rotation, level, created_at, accrual_start)
       VALUES ($1, $2, $3, $4, 0, 1, $5, $6)`,
      [
        villageId,
        building.type,
        building.x,
        building.y,
        at.toISOString(),
        isProducer ? at.toISOString() : null
      ]
    );
  }
  await moveResources(
    client,
    { kind: 'starter', fromVillageId: null, toVillageId: villageId, at },
    { brine: 1500, peat: 1500, copper: 100 }
  );
  await movePair(client, {
    kind: 'starter',
    asset: 'saltjack',
    amount: 10,
    fromVillageId: null,
    toVillageId: villageId,
    at
  });
  return villageId;
}

export async function collectProducer(
  client: Queryable,
  island: Island,
  building: BuildingRow,
  at: Date
): Promise<{ credited: ResourceAmounts; lost: ResourceAmounts }> {
  const split = await creditCapped(client, island, uncollectedOf(island, building), 'production', at);
  await client.query('UPDATE buildings SET accrual_start = $2 WHERE id = $1', [
    building.id,
    at.toISOString()
  ]);
  building.accrualStart = at;
  return split;
}
