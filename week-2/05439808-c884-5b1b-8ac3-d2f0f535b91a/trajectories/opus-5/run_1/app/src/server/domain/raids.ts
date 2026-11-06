import { randomInt } from 'node:crypto';
import type { Queryable } from '../db.js';
import { takeIslandLocks } from '../db.js';
import { config } from '../config.js';
import { plusSeconds } from '../clock.js';
import { buildingHitPoints, lootableFrom } from '../../shared/catalog.js';
import { simulate, type SimDeploy, type SimLayoutBuilding, type SimResult } from '../../shared/sim.js';
import type {
  RaidEndReason,
  RaidState,
  ResourceAmounts,
  UnitCounts,
  UnitKey
} from '../../shared/types.js';
import { RESOURCES, UNIT_KEYS } from '../../shared/types.js';
import { moveResources, movePair, resourcesOf, unitsOf } from './ledger.js';
import {
  creditCapped,
  loadIsland,
  storageRoom,
  type Island
} from './village.js';
import { localDayStart, nextLocalDayStart } from './localtime.js';
import { findAccountById } from './accounts.js';

export const STAR_BONUS_CAP = 5;
const STAR_BONUS_BRINE_PER_STAR = 100;

export type RaidResult = {
  finalTick: number;
  destruction: number;
  stars: number;
  lootable: ResourceAmounts;
  loot: ResourceAmounts;
  transferred: ResourceAmounts;
  trophies: { attacker: number; defender: number };
  starBonus: number;
};

export type RaidRow = {
  id: number;
  attackerVillageId: number;
  defenderVillageId: number;
  state: RaidState;
  endReason: RaidEndReason | null;
  lockedAt: Date;
  finalizeBy: Date;
  resolvedAt: Date | null;
  seed: number;
  layout: SimLayoutBuilding[];
  reservedArmy: UnitCounts;
  lootable: ResourceAmounts;
  resolutionLootable: ResourceAmounts | null;
  result: RaidResult | null;
  tickHashes: string[] | null;
  stars: number | null;
  destruction: number | null;
};

type RaidDbRow = {
  id: number;
  attacker_village_id: number;
  defender_village_id: number;
  state: string;
  end_reason: string | null;
  locked_at: Date;
  finalize_by: Date;
  resolved_at: Date | null;
  seed: number;
  layout: SimLayoutBuilding[];
  reserved_army: UnitCounts;
  lootable: ResourceAmounts;
  resolution_lootable: ResourceAmounts | null;
  result: RaidResult | null;
  tick_hashes: string[] | null;
  stars: number | null;
  destruction: number | null;
};

function mapRaid(row: RaidDbRow): RaidRow {
  return {
    id: Number(row.id),
    attackerVillageId: Number(row.attacker_village_id),
    defenderVillageId: Number(row.defender_village_id),
    state: row.state as RaidState,
    endReason: row.end_reason as RaidEndReason | null,
    lockedAt: row.locked_at,
    finalizeBy: row.finalize_by,
    resolvedAt: row.resolved_at,
    seed: Number(row.seed),
    layout: row.layout,
    reservedArmy: row.reserved_army,
    lootable: row.lootable,
    resolutionLootable: row.resolution_lootable,
    result: row.result,
    tickHashes: row.tick_hashes,
    stars: row.stars,
    destruction: row.destruction
  };
}

export async function applyLapsedRaids(client: Queryable, at: Date): Promise<void> {
  await client.query(
    `UPDATE raids SET state = 'abandoned', end_reason = 'deadline_passed'
      WHERE state IN ('locked', 'deploying') AND finalize_by <= $1`,
    [at.toISOString()]
  );
}

export async function loadRaid(client: Queryable, raidId: number): Promise<RaidRow | null> {
  const { rows } = await client.query<RaidDbRow>('SELECT * FROM raids WHERE id = $1', [raidId]);
  const row = rows[0];
  return row ? mapRaid(row) : null;
}

export async function deploysOf(client: Queryable, raidId: number): Promise<SimDeploy[]> {
  const { rows } = await client.query<{ tick: number; unit: string; x: number; y: number }>(
    'SELECT tick, unit, x, y FROM raid_deploys WHERE raid_id = $1 ORDER BY seq',
    [raidId]
  );
  return rows.map((row) => ({ tick: row.tick, unit: row.unit as UnitKey, x: row.x, y: row.y }));
}

export type VillagePublic = { villageId: number; accountId: number; displayName: string; trophies: number };

export async function villagePublic(
  client: Queryable,
  villageId: number
): Promise<VillagePublic | null> {
  const { rows } = await client.query<{
    id: number;
    account_id: number;
    display_name: string;
    trophies: number;
  }>(
    `SELECT v.id, v.account_id, a.display_name, a.trophies
       FROM villages v JOIN accounts a ON a.id = v.account_id
      WHERE v.id = $1`,
    [villageId]
  );
  const row = rows[0];
  return row
    ? {
        villageId: Number(row.id),
        accountId: Number(row.account_id),
        displayName: row.display_name,
        trophies: row.trophies
      }
    : null;
}

export async function raidView(
  client: Queryable,
  raid: RaidRow
): Promise<Record<string, unknown>> {
  const attacker = await villagePublic(client, raid.attackerVillageId);
  const defender = await villagePublic(client, raid.defenderVillageId);
  return {
    id: raid.id,
    state: raid.state,
    endReason: raid.endReason,
    attacker: { villageId: raid.attackerVillageId, displayName: attacker?.displayName ?? '' },
    defender: { villageId: raid.defenderVillageId, displayName: defender?.displayName ?? '' },
    lockedAt: raid.lockedAt.toISOString(),
    finalizeBy: raid.finalizeBy.toISOString(),
    seed: raid.seed,
    layout: raid.layout,
    army: raid.reservedArmy,
    lootable: raid.lootable,
    deploys: await deploysOf(client, raid.id),
    result: raid.result,
    resolvedAt: raid.resolvedAt === null ? null : raid.resolvedAt.toISOString()
  };
}

export function layoutOf(island: Island): SimLayoutBuilding[] {
  return island.buildings
    .filter((building) => building.level >= 1)
    .map((building, index) => ({
      index,
      id: building.id,
      type: building.type,
      x: building.x,
      y: building.y,
      rotation: building.rotation,
      level: building.level,
      hp: buildingHitPoints(building.type, building.level)
    }));
}

export function lootableOf(island: Island): ResourceAmounts {
  const balances = resourcesOf(island.balances);
  return {
    brine: lootableFrom(balances.brine),
    peat: lootableFrom(balances.peat),
    copper: lootableFrom(balances.copper)
  };
}

export async function activeRaidOnIsland(
  client: Queryable,
  defenderVillageId: number
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM raids
        WHERE defender_village_id = $1 AND state IN ('locked', 'deploying')
     ) AS exists`,
    [defenderVillageId]
  );
  return rows[0]?.exists === true;
}

export async function attackerHasActiveRaid(
  client: Queryable,
  attackerVillageId: number
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM raids
        WHERE attacker_village_id = $1 AND state IN ('locked', 'deploying')
     ) AS exists`,
    [attackerVillageId]
  );
  return rows[0]?.exists === true;
}

export async function inTargetCooldown(
  client: Queryable,
  attackerVillageId: number,
  defenderVillageId: number,
  at: Date
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM raids
        WHERE attacker_village_id = $1 AND defender_village_id = $2
          AND state = 'resolved' AND resolved_at > $3
     ) AS exists`,
    [
      attackerVillageId,
      defenderVillageId,
      new Date(at.getTime() - config.targetCooldownSeconds * 1000).toISOString()
    ]
  );
  return rows[0]?.exists === true;
}

function newSeed(): number {
  return randomInt(1, 4_294_967_296);
}

export async function createLock(
  client: Queryable,
  attacker: Island,
  defender: Island,
  at: Date
): Promise<RaidRow> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO raids
       (attacker_village_id, defender_village_id, state, locked_at, finalize_by, seed,
        layout, reserved_army, lootable)
     VALUES ($1, $2, 'locked', $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      attacker.villageId,
      defender.villageId,
      at.toISOString(),
      plusSeconds(at, config.raidFinalizeSeconds).toISOString(),
      newSeed(),
      JSON.stringify(layoutOf(defender)),
      JSON.stringify(unitsOf(attacker.balances)),
      JSON.stringify(lootableOf(defender))
    ]
  );
  const raid = await loadRaid(client, Number(rows[0]?.id));
  if (raid === null) throw new Error('raid lock vanished');
  return raid;
}

function deployedCounts(deploys: readonly SimDeploy[]): UnitCounts {
  const counts: UnitCounts = { saltjack: 0, peat_slinger: 0 };
  for (const deploy of deploys) counts[deploy.unit] += 1;
  return counts;
}

export function simulateRaid(raid: RaidRow, deploys: readonly SimDeploy[]): SimResult {
  return simulate({
    seed: raid.seed,
    layout: raid.layout,
    deploys,
    lootable: raid.resolutionLootable ?? raid.lootable
  });
}

export async function starBonusUsed(
  client: Queryable,
  attackerVillageId: number,
  zone: string,
  at: Date
): Promise<number> {
  const { rows } = await client.query<{ used: number }>(
    `SELECT COUNT(*)::int AS used FROM raids
      WHERE attacker_village_id = $1 AND state = 'resolved'
        AND star_bonus > 0 AND resolved_at >= $2 AND resolved_at < $3`,
    [
      attackerVillageId,
      localDayStart(zone, at).toISOString(),
      nextLocalDayStart(zone, at).toISOString()
    ]
  );
  return Number(rows[0]?.used ?? 0);
}

export async function resolveRaid(
  client: Queryable,
  raid: RaidRow,
  deploys: readonly SimDeploy[],
  at: Date
): Promise<RaidRow> {
  await takeIslandLocks(client, [raid.attackerVillageId, raid.defenderVillageId]);
  const attacker = await loadIsland(client, raid.attackerVillageId, at);
  const defender = await loadIsland(client, raid.defenderVillageId, at);
  if (attacker === null || defender === null) throw new Error('raid island vanished');

  const resolutionLootable = lootableOf(defender);
  const simulated = simulate({
    seed: raid.seed,
    layout: raid.layout,
    deploys,
    lootable: resolutionLootable
  });
  const finalState = simulated.ticks[simulated.ticks.length - 1];
  if (!finalState) throw new Error('simulation produced no ticks');

  const room = storageRoom(attacker);
  const transferred: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
  for (const resource of RESOURCES) {
    transferred[resource] = Math.min(finalState.loot[resource], room[resource]);
  }
  await moveResources(
    client,
    {
      kind: 'raid_loot',
      fromVillageId: defender.villageId,
      toVillageId: attacker.villageId,
      raidId: raid.id,
      at
    },
    transferred
  );
  for (const resource of RESOURCES) {
    attacker.balances[resource] += transferred[resource];
    defender.balances[resource] -= transferred[resource];
  }

  const deployed = deployedCounts(deploys);
  for (const unit of UNIT_KEYS) {
    if (deployed[unit] === 0) continue;
    await movePair(client, {
      kind: 'raid_deploy',
      asset: unit,
      amount: deployed[unit],
      fromVillageId: attacker.villageId,
      toVillageId: null,
      raidId: raid.id,
      at
    });
  }

  const attackerAccount = await findAccountById(client, attacker.accountId);
  const defenderAccount = await findAccountById(client, defender.accountId);
  if (attackerAccount === null || defenderAccount === null) throw new Error('raid account vanished');

  let attackerChange: number;
  let defenderChange: number;
  if (finalState.stars >= 1) {
    const gain = Math.floor(finalState.destruction / 4);
    attackerChange = gain;
    defenderChange = -Math.min(defenderAccount.trophies, Math.floor(gain / 2));
  } else {
    attackerChange = -Math.min(attackerAccount.trophies, 3);
    defenderChange = 3;
  }
  await client.query('UPDATE accounts SET trophies = trophies + $2 WHERE id = $1', [
    attackerAccount.id,
    attackerChange
  ]);
  await client.query('UPDATE accounts SET trophies = trophies + $2 WHERE id = $1', [
    defenderAccount.id,
    defenderChange
  ]);

  let starBonus = 0;
  if (finalState.stars >= 1) {
    const used = await starBonusUsed(client, attacker.villageId, attackerAccount.timeZone, at);
    if (used < STAR_BONUS_CAP) {
      starBonus = STAR_BONUS_BRINE_PER_STAR * finalState.stars;
      await creditCapped(
        client,
        attacker,
        { brine: starBonus, peat: 0, copper: 0 },
        'star_bonus',
        at
      );
    }
  }

  if (finalState.stars >= 2) {
    const shieldEnd = plusSeconds(at, config.shieldSeconds);
    await client.query(
      `UPDATE villages SET shield_ends_at = GREATEST(COALESCE(shield_ends_at, $2), $2)
        WHERE id = $1`,
      [defender.villageId, shieldEnd.toISOString()]
    );
  }

  const result: RaidResult = {
    finalTick: simulated.finalTick,
    destruction: finalState.destruction,
    stars: finalState.stars,
    lootable: resolutionLootable,
    loot: finalState.loot,
    transferred,
    trophies: { attacker: attackerChange, defender: defenderChange },
    starBonus
  };

  await client.query(
    `UPDATE raids
       SET state = 'resolved', end_reason = 'finalized', resolved_at = $2,
           resolution_lootable = $3, result = $4, tick_hashes = $5,
           stars = $6, destruction = $7, star_bonus = $8
     WHERE id = $1`,
    [
      raid.id,
      at.toISOString(),
      JSON.stringify(resolutionLootable),
      JSON.stringify(result),
      JSON.stringify(simulated.ticks.map((tick) => tick.hash)),
      result.stars,
      result.destruction,
      starBonus
    ]
  );

  const reloaded = await loadRaid(client, raid.id);
  if (reloaded === null) throw new Error('resolved raid vanished');
  return reloaded;
}

export function snapshotView(
  raid: RaidRow,
  deploys: readonly SimDeploy[],
  tick: number
): Record<string, unknown> {
  const simulated = simulateRaid(raid, deploys);
  const state = simulated.ticks[tick];
  if (!state) throw new Error('snapshot tick outside the simulated range');
  return {
    raidId: raid.id,
    tick: state.tick,
    finalTick: simulated.finalTick,
    destruction: state.destruction,
    stars: state.stars,
    loot: state.loot,
    hash: state.hash,
    buildings: raid.layout.map((building, index) => ({
      index: building.index,
      id: building.id,
      hp: state.buildingHp[index] ?? 0,
      destroyed: (state.buildingHp[index] ?? 0) === 0
    })),
    units: state.units.map((unit, index) => ({
      index,
      unit: unit.unit,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
      alive: unit.alive
    }))
  };
}

export function isShieldedVillage(island: Island, at: Date): boolean {
  return island.shieldEndsAt !== null && at.getTime() < island.shieldEndsAt.getTime();
}
