// The island core: derived storage caps, saltmark, builders, housing, producer accrual, and the
// application of completed jobs and finished training batches before any read or change.
import type { PoolClient } from 'pg';
import { BUILDINGS, BASE_STORAGE, buildersTotal, leagueFor, lootableFrom } from '../domain/catalog.ts';
import type { BuildingType, ResourceAmounts } from '../domain/types.ts';
import type { Balances } from './ledger.ts';
import { balancesOf, tidePair } from './ledger.ts';

export const STARTER_BUILDINGS: { type: BuildingType; x: number; y: number; rotation: number }[] = [
  { type: 'tide_barracks', x: 12, y: 18, rotation: 0 },
  { type: 'driftwood_camp', x: 25, y: 18, rotation: 0 },
  { type: 'brine_pan', x: 12, y: 24, rotation: 0 },
  { type: 'peat_cutter', x: 26, y: 24, rotation: 0 },
  { type: 'kiln_tower', x: 18, y: 26, rotation: 0 },
];

export interface BuildingRow {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: number;
  level: number;
  created_at: number;
  job_to_level: number | null;
  job_started_at: number | null;
  job_finishes_at: number | null;
  job_cost_brine: number;
  job_cost_peat: number;
  job_cost_copper: number;
  accrual_started_at: number | null;
}

export interface BatchRow {
  id: number;
  unit: 'saltjack' | 'peat_slinger';
  count: number;
  starts_at: number;
  finishes_at: number;
}

export interface VillageRow {
  id: number;
  account_id: number;
  trophies: number;
  shield_ends_at: number | null;
  created_at: number;
}

export interface IslandState {
  village: VillageRow;
  buildings: BuildingRow[];
  balances: Balances;
  caps: ResourceAmounts;
  saltmark: number;
  builders: { total: number; free: number };
  housing: { used: number; capacity: number };
  training: BatchRow[];
  underAttack: boolean;
  shieldEndsAt: number | null;
}

const BUILDING_SELECT = `SELECT id, type, x, y, rotation, level, created_at, job_to_level, job_started_at,
  job_finishes_at, job_cost_brine, job_cost_peat, job_cost_copper, accrual_started_at
  FROM buildings WHERE village_id = $1 ORDER BY created_at, id`;

function mapBuilding(row: Record<string, unknown>): BuildingRow {
  return {
    id: Number(row.id),
    type: row.type as BuildingType,
    x: row.x as number,
    y: row.y as number,
    rotation: row.rotation as number,
    level: row.level as number,
    created_at: Number(row.created_at),
    job_to_level: row.job_to_level === null ? null : Number(row.job_to_level),
    job_started_at: row.job_started_at === null ? null : Number(row.job_started_at),
    job_finishes_at: row.job_finishes_at === null ? null : Number(row.job_finishes_at),
    job_cost_brine: row.job_cost_brine as number,
    job_cost_peat: row.job_cost_peat as number,
    job_cost_copper: row.job_cost_copper as number,
    accrual_started_at: row.accrual_started_at === null ? null : Number(row.accrual_started_at),
  };
}

// Takes the island's lock. Throws not_found-shaped null when the village does not exist.
export async function lockVillage(client: PoolClient, villageId: number): Promise<VillageRow | null> {
  const result = await client.query('SELECT id, account_id, trophies, shield_ends_at, created_at FROM villages WHERE id = $1 FOR UPDATE', [villageId]);
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: Number(r.id),
    account_id: Number(r.account_id),
    trophies: r.trophies as number,
    shield_ends_at: r.shield_ends_at === null ? null : Number(r.shield_ends_at),
    created_at: Number(r.created_at),
  };
}

export async function lockVillages(client: PoolClient, ids: number[]): Promise<Map<number, VillageRow | null>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b); // always locked in id order to avoid deadlock
  const map = new Map<number, VillageRow | null>();
  for (const id of unique) map.set(id, await lockVillage(client, id));
  return map;
}

// Raids whose finalize deadline passed become abandoned before any read or change of them or
// either island; this releases their lock so other raiders can strike the island again.
export async function abandonExpiredRaids(
  client: PoolClient,
  now: number,
  filter: { defenderVillageId?: number; attackerVillageId?: number; raidId?: number }
): Promise<void> {
  const conditions = ["state IN ('locked', 'deploying')", 'finalize_by <= $1'];
  const params: unknown[] = [now];
  if (filter.defenderVillageId !== undefined) {
    params.push(filter.defenderVillageId);
    conditions.push(`defender_village_id = $${params.length}`);
  }
  if (filter.attackerVillageId !== undefined) {
    params.push(filter.attackerVillageId);
    conditions.push(`attacker_village_id = $${params.length}`);
  }
  if (filter.raidId !== undefined) {
    params.push(filter.raidId);
    conditions.push(`id = $${params.length}`);
  }
  await client.query(
    `UPDATE raids SET state = 'abandoned', end_reason = 'deadline_passed' WHERE ${conditions.join(' AND ')}`,
    params
  );
}

// Applies completed jobs and finished training batches, in finish order, before any read or change.
export async function applyCompleted(client: PoolClient, villageId: number, now: number): Promise<void> {
  const jobs = await client.query(
    `SELECT id, job_to_level, job_finishes_at, type FROM buildings
     WHERE village_id = $1 AND job_finishes_at IS NOT NULL AND job_finishes_at <= $2
     ORDER BY job_finishes_at, id FOR UPDATE`,
    [villageId, now]
  );
  const batches = await client.query(
    `SELECT id, unit, count, finishes_at FROM training_batches
     WHERE village_id = $1 AND status = 'queued' AND finishes_at <= $2
     ORDER BY finishes_at, id FOR UPDATE`,
    [villageId, now]
  );
  type Event = { at: number; id: number; kind: 'job' | 'batch' };
  const events: Event[] = [
    ...jobs.rows.map((r) => ({ at: Number(r.job_finishes_at), id: Number(r.id), kind: 'job' as const })),
    ...batches.rows.map((r) => ({ at: Number(r.finishes_at), id: Number(r.id), kind: 'batch' as const })),
  ].sort((a, b) => a.at - b.at || a.id - b.id);

  for (const event of events) {
    if (event.kind === 'job') {
      const row = jobs.rows.find((r) => Number(r.id) === event.id);
      if (!row) continue;
      const spec = BUILDINGS[row.type as BuildingType];
      await client.query(
        `UPDATE buildings SET level = $2, job_to_level = NULL, job_started_at = NULL, job_finishes_at = NULL,
         job_cost_brine = 0, job_cost_peat = 0, job_cost_copper = 0,
         accrual_started_at = CASE WHEN $3 THEN $4 ELSE accrual_started_at END
         WHERE id = $1`,
        [event.id, row.job_to_level, spec.producer !== undefined, event.at]
      );
    } else {
      const row = batches.rows.find((r) => Number(r.id) === event.id);
      if (!row) continue;
      await tidePair(client, villageId, 'train_complete', row.unit as 'saltjack' | 'peat_slinger', Number(row.count), event.at);
      await client.query(`UPDATE training_batches SET status = 'finished' WHERE id = $1`, [event.id]);
    }
  }
}

export function storageCapsOf(buildings: BuildingRow[]): ResourceAmounts {
  const caps: ResourceAmounts = { ...BASE_STORAGE };
  for (const b of buildings) {
    const spec = BUILDINGS[b.type];
    if (spec.storage && b.level >= 1) caps[spec.storage.resource] += spec.storage.cap[b.level - 1];
  }
  return caps;
}

export function saltmarkOf(buildings: BuildingRow[]): number {
  return buildings.reduce((acc, b) => acc + b.level, 0);
}

export function buildersOf(buildings: BuildingRow[]): { total: number; free: number } {
  const total = buildersTotal(saltmarkOf(buildings));
  const running = buildings.filter((b) => b.job_finishes_at !== null).length;
  return { total, free: total - running };
}

export function housingOf(buildings: BuildingRow[], balances: Balances, training: BatchRow[]): { used: number; capacity: number } {
  let capacity = 0;
  for (const b of buildings) {
    const spec = BUILDINGS[b.type];
    if (spec.housing && b.level >= 1) capacity += spec.housing[b.level - 1];
  }
  const queued = training.reduce((acc, t) => acc + t.count, 0);
  const used = balances.saltjack + balances.peat_slinger + queued;
  return { used, capacity };
}

// A producer's uncollected output, capped by its buffer; a producer with a running job makes none.
export function uncollectedOf(building: BuildingRow, now: number): number {
  const spec = BUILDINGS[building.type];
  if (!spec.producer || building.level < 1 || building.job_finishes_at !== null || building.accrual_started_at === null) return 0;
  const producer = spec.producer;
  const accrued = Math.floor((producer.ratePerHour[building.level - 1] * (now - building.accrual_started_at)) / 3600000);
  return Math.min(producer.buffer[building.level - 1], accrued);
}

export async function loadIsland(client: PoolClient, villageId: number, now: number): Promise<IslandState> {
  await abandonExpiredRaids(client, now, { defenderVillageId: villageId });
  await applyCompleted(client, villageId, now);

  const villageResult = await client.query('SELECT id, account_id, trophies, shield_ends_at, created_at FROM villages WHERE id = $1', [villageId]);
  const villageRow = villageResult.rows[0];
  const buildings = (await client.query(BUILDING_SELECT, [villageId])).rows.map(mapBuilding);
  const balances = await balancesOf(client, villageId);
  const trainingResult = await client.query(
    `SELECT id, unit, count, starts_at, finishes_at FROM training_batches
     WHERE village_id = $1 AND status = 'queued' ORDER BY starts_at, id`,
    [villageId]
  );
  const training: BatchRow[] = trainingResult.rows.map((r) => ({
    id: Number(r.id),
    unit: r.unit as 'saltjack' | 'peat_slinger',
    count: r.count as number,
    starts_at: Number(r.starts_at),
    finishes_at: Number(r.finishes_at),
  }));
  const attackResult = await client.query(
    `SELECT 1 FROM raids WHERE defender_village_id = $1 AND state IN ('locked', 'deploying') LIMIT 1`,
    [villageId]
  );
  return {
    village: {
      id: Number(villageRow.id),
      account_id: Number(villageRow.account_id),
      trophies: villageRow.trophies as number,
      shield_ends_at: villageRow.shield_ends_at === null ? null : Number(villageRow.shield_ends_at),
      created_at: Number(villageRow.created_at),
    },
    buildings,
    balances,
    caps: storageCapsOf(buildings),
    saltmark: saltmarkOf(buildings),
    builders: buildersOf(buildings),
    housing: housingOf(buildings, balances, training),
    training,
    underAttack: attackResult.rows.length > 0,
    shieldEndsAt: villageRow.shield_ends_at !== null && now < Number(villageRow.shield_ends_at) ? Number(villageRow.shield_ends_at) : null,
  };
}

// Every new account's island starts with the same five buildings and starter amounts.
export async function createStarterVillage(client: PoolClient, accountId: number, now: number): Promise<void> {
  const village = await client.query<{ id: string }>('INSERT INTO villages (account_id, created_at) VALUES ($1, $2) RETURNING id', [accountId, now]);
  const villageId = Number(village.rows[0].id);
  await layOutStarterIsland(client, villageId, now);
}

export async function layOutStarterIsland(client: PoolClient, villageId: number, now: number): Promise<void> {
  for (const b of STARTER_BUILDINGS) {
    await client.query(
      `INSERT INTO buildings (village_id, type, x, y, rotation, level, created_at, accrual_started_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6)`,
      [villageId, b.type, b.x, b.y, b.rotation, now]
    );
  }
  const starter: { asset: string; amount: number }[] = [
    { asset: 'brine', amount: 1500 },
    { asset: 'peat', amount: 1500 },
    { asset: 'copper', amount: 100 },
    { asset: 'saltjack', amount: 10 },
  ];
  for (const s of starter) {
    const pair = await client.query<{ nextval: string }>('SELECT nextval($1) AS nextval', ['ledger_pair_seq']);
    const pairId = Number(pair.rows[0].nextval);
    await client.query(
      `INSERT INTO ledger (pair_id, village_id, kind, asset, amount, counterparty_kind, counterparty_village_id, raid_id, created_at)
       VALUES ($1, $2, 'starter', $3, $4, 'tide', NULL, NULL, $5), ($1, NULL, 'starter', $3, $6, 'tide', NULL, NULL, $5)`,
      [pairId, villageId, s.asset, s.amount, now, -s.amount]
    );
  }
}

export function buildingJson(b: BuildingRow, now: number): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: b.id,
    type: b.type,
    x: b.x,
    y: b.y,
    rotation: b.rotation,
    level: b.level,
    upgrade:
      b.job_to_level === null || b.job_started_at === null || b.job_finishes_at === null
        ? null
        : {
            toLevel: b.job_to_level,
            startedAt: new Date(b.job_started_at).toISOString(),
            finishesAt: new Date(b.job_finishes_at).toISOString(),
          },
  };
  if (BUILDINGS[b.type].producer) json.uncollected = uncollectedOf(b, now);
  return json;
}

export function villageJson(state: IslandState, displayName: string, now: number): Record<string, unknown> {
  return {
    id: state.village.id,
    displayName,
    grid: { width: 40, height: 40 },
    buildings: state.buildings.map((b) => buildingJson(b, now)),
    resources: {
      brine: { amount: state.balances.brine, cap: state.caps.brine },
      peat: { amount: state.balances.peat, cap: state.caps.peat },
      copper: { amount: state.balances.copper, cap: state.caps.copper },
    },
    saltmark: state.saltmark,
    builders: state.builders,
    army: {
      units: { saltjack: state.balances.saltjack, peat_slinger: state.balances.peat_slinger },
      training: state.training.map((t) => ({
        id: t.id,
        unit: t.unit,
        count: t.count,
        startsAt: new Date(t.starts_at).toISOString(),
        finishesAt: new Date(t.finishes_at).toISOString(),
      })),
      housing: state.housing,
    },
    shield: state.shieldEndsAt === null ? null : { endsAt: new Date(state.shieldEndsAt).toISOString() },
    underAttack: state.underAttack,
    trophies: state.village.trophies,
    league: leagueFor(state.village.trophies),
    serverTime: new Date(now).toISOString(),
  };
}

export function lootableOf(balances: Balances): ResourceAmounts {
  return { brine: lootableFrom(balances.brine), peat: lootableFrom(balances.peat), copper: lootableFrom(balances.copper) };
}

