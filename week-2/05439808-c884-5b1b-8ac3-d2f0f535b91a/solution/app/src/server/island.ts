// The island: its lock, ledger pairs, balances, and every derived counter (storage cap, saltmark,
// builders, housing, uncollected output, lootable amounts). Each rule is decided here once.
import {
  appliedSeconds, BUILDINGS, RESOURCES, UNIT_KEYS, UNITS, zeroAmounts,
  type Amounts, type ArmyCounts, type Asset, type BuildingType, type Resource, type Rotation, type UnitKey,
} from '../shared/catalog';
import { config } from './config';
import { iso } from './clock';
import type { Db } from './db';

type LedgerKind =
  | 'starter' | 'production' | 'build_spend' | 'refund' | 'train_spend' | 'train_complete' | 'raid_loot'
  | 'raid_deploy' | 'star_bonus' | 'daily_chest' | 'league_bonus' | 'donation';

export interface BuildingRow {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  job_to_level: number | null;
  job_started_at: number | null;
  job_finishes_at: number | null;
  job_cost: Amounts | null;
  accrual_start: number;
  created_at: number;
}

export interface BatchRow {
  id: number;
  unit: UnitKey;
  count: number;
  cost: Amounts;
  enqueued_at: number;
  starts_at: number;
  finishes_at: number;
}

export interface Island {
  villageId: number;
  accountId: number;
  shieldStart: number | null;
  shieldEnd: number | null;
  buildings: BuildingRow[];
  batches: BatchRow[];
  balances: Record<Asset, number>;
}

const BASE_STORAGE: Amounts = { brine: 2000, peat: 2000, copper: 200 };

/** Writes one ledger pair: `to` gains `amount`, `from` loses it; null is the tide. */
export async function writePair(
  db: Db,
  pair: { kind: LedgerKind; asset: Asset; amount: number; from: number | null; to: number | null; raidId?: number | null; at: number },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>("SELECT nextval('ledger_pair_ids') AS id");
  const pairId = (rows[0] as { id: number }).id;
  await db.query(
    `INSERT INTO ledger_entries (pair_id, village_id, counterparty_village_id, kind, asset, amount, raid_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($1, $3, $2, $4, $5, $9, $7, $8)`,
    [pairId, pair.to, pair.from, pair.kind, pair.asset, pair.amount, pair.raidId ?? null, pair.at, -pair.amount],
  );
  return pairId;
}

/** Moves an amount between an island and the tide (or another island) and keeps the in-memory balance in step. */
export async function move(
  db: Db,
  island: Island,
  change: { kind: LedgerKind; asset: Asset; amount: number; other?: Island | null; raidId?: number | null; at: number },
): Promise<number | null> {
  if (change.amount === 0) return null;
  const outward = change.amount < 0;
  const size = Math.abs(change.amount);
  const other = change.other ?? null;
  const pairId = await writePair(db, {
    kind: change.kind,
    asset: change.asset,
    amount: size,
    from: outward ? island.villageId : other?.villageId ?? null,
    to: outward ? other?.villageId ?? null : island.villageId,
    raidId: change.raidId ?? null,
    at: change.at,
  });
  island.balances[change.asset] += change.amount;
  if (other) other.balances[change.asset] -= change.amount;
  return pairId;
}

export function storageCaps(buildings: readonly BuildingRow[]): Amounts {
  const caps = { ...BASE_STORAGE };
  for (const b of buildings) {
    const storage = BUILDINGS[b.type].storage;
    if (storage && b.level > 0) caps[storage.resource] += storage.cap[b.level - 1] as number;
  }
  return caps;
}

export function saltmark(buildings: readonly BuildingRow[]): number {
  return buildings.reduce((sum, b) => sum + b.level, 0);
}

export function builders(buildings: readonly BuildingRow[]): { total: number; free: number } {
  const total = Math.min(5, 2 + Math.floor(saltmark(buildings) / 8));
  return { total, free: total - buildings.filter((b) => b.job_to_level !== null).length };
}

export function housing(island: Island): { used: number; capacity: number } {
  const capacity = island.buildings.reduce((sum, b) => {
    const spec = BUILDINGS[b.type].housing;
    return sum + (spec && b.level > 0 ? (spec[b.level - 1] as number) : 0);
  }, 0);
  const trained = UNIT_KEYS.reduce((sum, u) => sum + island.balances[u] * UNITS[u].housing, 0);
  const queued = island.batches.reduce((sum, b) => sum + b.count * UNITS[b.unit].housing, 0);
  return { used: trained + queued, capacity };
}

export function army(island: Island): ArmyCounts {
  return { saltjack: island.balances.saltjack, peat_slinger: island.balances.peat_slinger };
}

/** Room left under each storage cap. */
export function room(island: Island): Amounts {
  const caps = storageCaps(island.buildings);
  return { brine: caps.brine - island.balances.brine, peat: caps.peat - island.balances.peat, copper: caps.copper - island.balances.copper };
}

/** A producer's uncollected output: min(buffer, floor(rate × whole ms ÷ 3,600,000)); nothing while a job runs. */
export function uncollected(b: BuildingRow, at: number): number {
  const producer = BUILDINGS[b.type].producer;
  if (!producer || b.level === 0 || b.job_to_level !== null) return 0;
  const rate = producer.perHour[b.level - 1] as number;
  const buffer = producer.buffer[b.level - 1] as number;
  return Math.min(buffer, Math.floor((rate * Math.max(0, at - b.accrual_start)) / 3600000));
}

/** The amount a raid can take per resource: floor(balance × 20 ÷ 100). */
export function lootable(island: Island): Amounts {
  const out = zeroAmounts();
  for (const r of RESOURCES) out[r] = Math.floor((island.balances[r] * 20) / 100);
  return out;
}

/** Credits resources from the tide, each capped by room; returns what landed and what was lost. */
export async function creditCapped(
  db: Db,
  island: Island,
  amounts: Amounts,
  kind: LedgerKind,
  at: number,
  raidId: number | null = null,
): Promise<{ credited: Amounts; lost: Amounts }> {
  const free = room(island);
  const credited = zeroAmounts();
  const lost = zeroAmounts();
  for (const r of RESOURCES) {
    credited[r] = Math.max(0, Math.min(amounts[r], free[r]));
    lost[r] = amounts[r] - credited[r];
    await move(db, island, { kind, asset: r, amount: credited[r], raidId, at });
  }
  return { credited, lost };
}

export function affordable(island: Island, cost: Amounts): boolean {
  return RESOURCES.every((r) => island.balances[r] >= cost[r]);
}

export async function spend(db: Db, island: Island, cost: Amounts, kind: LedgerKind, at: number): Promise<void> {
  for (const r of RESOURCES) await move(db, island, { kind, asset: r, amount: -cost[r], at });
}

export const jobMs = (type: BuildingType, level: number): number =>
  appliedSeconds(BUILDINGS[type].buildSeconds[level - 1] as number, config.buildTimeDivisor) * 1000;

export const batchMs = (unit: UnitKey, count: number): number =>
  count * appliedSeconds(UNITS[unit].trainSeconds, config.buildTimeDivisor) * 1000;

/** The training queue schedule: the head starts at `headStart`, each later batch at the finish of the one ahead. */
export function scheduleBatches(queue: BatchRow[], headStart: number): void {
  let start = headStart;
  queue.forEach((batch, i) => {
    batch.starts_at = i === 0 ? Math.max(headStart, batch.enqueued_at) : start;
    batch.finishes_at = batch.starts_at + batchMs(batch.unit, batch.count);
    start = batch.finishes_at;
  });
}

async function loadBalances(db: Db, villageId: number): Promise<Record<Asset, number>> {
  const { rows } = await db.query<{ asset: Asset; total: number }>(
    'SELECT asset, COALESCE(SUM(amount), 0)::bigint AS total FROM ledger_entries WHERE village_id = $1 GROUP BY asset',
    [villageId],
  );
  const balances: Record<Asset, number> = { brine: 0, peat: 0, copper: 0, saltjack: 0, peat_slinger: 0 };
  for (const row of rows) balances[row.asset] = row.total;
  return balances;
}

/**
 * Locks an island's balances and brings it up to `at`: completed jobs and finished training
 * batches are applied in finish order before anything else reads or changes the island.
 */
export async function lockIsland(db: Db, villageId: number, at: number): Promise<Island> {
  const village = await db.query<{ account_id: number; shield_start: number | null; shield_end: number | null }>(
    'SELECT account_id, shield_start, shield_end FROM villages WHERE id = $1 FOR UPDATE',
    [villageId],
  );
  const row = village.rows[0] as { account_id: number; shield_start: number | null; shield_end: number | null };
  const buildings = (await db.query<BuildingRow>('SELECT * FROM buildings WHERE village_id = $1 ORDER BY created_at, id', [villageId])).rows;
  const batches = (await db.query<BatchRow>(
    "SELECT id, unit, count, cost, enqueued_at, starts_at, finishes_at FROM training_batches WHERE village_id = $1 AND state = 'queued' ORDER BY id",
    [villageId],
  )).rows;
  const island: Island = {
    villageId,
    accountId: row.account_id,
    shieldStart: row.shield_start,
    shieldEnd: row.shield_end,
    buildings,
    batches,
    balances: await loadBalances(db, villageId),
  };

  const due = [
    ...buildings.filter((b) => b.job_finishes_at !== null && b.job_finishes_at <= at).map((b) => ({ at: b.job_finishes_at as number, building: b, batch: null })),
    ...batches.filter((b) => b.finishes_at <= at).map((b) => ({ at: b.finishes_at, building: null, batch: b })),
  ].sort((a, b) => a.at - b.at);
  for (const event of due) {
    if (event.building) {
      const b = event.building;
      b.level = b.job_to_level as number;
      b.accrual_start = b.job_finishes_at as number;
      b.job_to_level = null;
      b.job_started_at = null;
      b.job_finishes_at = null;
      b.job_cost = null;
      await db.query(
        'UPDATE buildings SET level = $2, accrual_start = $3, job_to_level = NULL, job_started_at = NULL, job_finishes_at = NULL, job_cost = NULL WHERE id = $1',
        [b.id, b.level, b.accrual_start],
      );
    } else if (event.batch) {
      const batch = event.batch;
      await db.query("UPDATE training_batches SET state = 'done' WHERE id = $1", [batch.id]);
      await move(db, island, { kind: 'train_complete', asset: batch.unit, amount: batch.count, at: batch.finishes_at });
      island.batches = island.batches.filter((b) => b.id !== batch.id);
    }
  }
  return island;
}

/** Locks two islands in id order, so two requests touching the same pair never deadlock. */
export async function lockIslands(db: Db, first: number, second: number, at: number): Promise<[Island, Island]> {
  if (first < second) {
    const a = await lockIsland(db, first, at);
    return [a, await lockIsland(db, second, at)];
  }
  const b = await lockIsland(db, second, at);
  return [await lockIsland(db, first, at), b];
}

export function buildingView(b: BuildingRow, at: number): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: b.id,
    type: b.type,
    x: b.x,
    y: b.y,
    rotation: b.rotation,
    level: b.level,
    upgrade: b.job_to_level === null
      ? null
      : { toLevel: b.job_to_level, startedAt: iso(b.job_started_at as number), finishesAt: iso(b.job_finishes_at as number) },
  };
  if (BUILDINGS[b.type].producer) view.uncollected = uncollected(b, at);
  return view;
}

export function armyView(island: Island): Record<string, unknown> {
  return {
    units: army(island),
    training: island.batches.map((b) => ({ id: b.id, unit: b.unit, count: b.count, startsAt: iso(b.starts_at), finishesAt: iso(b.finishes_at) })),
    housing: housing(island),
  };
}

export function isShielded(island: Island, at: number): boolean {
  return island.shieldStart !== null && island.shieldEnd !== null && at >= island.shieldStart && at < island.shieldEnd;
}

export function resourceView(island: Island): Record<Resource, { amount: number; cap: number }> {
  const caps = storageCaps(island.buildings);
  return {
    brine: { amount: island.balances.brine, cap: caps.brine },
    peat: { amount: island.balances.peat, cap: caps.peat },
    copper: { amount: island.balances.copper, cap: caps.copper },
  };
}
