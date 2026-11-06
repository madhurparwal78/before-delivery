import type { Queryable } from '../db.js';
import { BUILDINGS, GRID_HEIGHT, GRID_WIDTH } from '../../shared/catalog.js';
import { leagueFor } from '../../shared/types.js';
import type { AccountRecord } from './accounts.js';
import { clanIdOf, villageIdOf } from './accounts.js';
import { resourcesOf, unitsOf } from './ledger.js';
import {
  buildersOf,
  housingCapacity,
  housingUsed,
  saltmarkOf,
  storageCaps,
  uncollectedOf,
  type BuildingRow,
  type Island
} from './village.js';

export async function meView(
  client: Queryable,
  account: AccountRecord
): Promise<Record<string, unknown>> {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    timeZone: account.timeZone,
    verified: account.verified,
    role: account.role,
    villageId: await villageIdOf(client, account.id),
    trophies: account.trophies,
    league: leagueFor(account.trophies),
    clanId: await clanIdOf(client, account.id)
  };
}

export function buildingView(island: Island, building: BuildingRow): Record<string, unknown> {
  const spec = BUILDINGS[building.type];
  const view: Record<string, unknown> = {
    id: building.id,
    type: building.type,
    x: building.x,
    y: building.y,
    rotation: building.rotation,
    level: building.level,
    upgrade:
      building.jobToLevel === null || building.jobStartedAt === null || building.jobFinishesAt === null
        ? null
        : {
            toLevel: building.jobToLevel,
            startedAt: building.jobStartedAt.toISOString(),
            finishesAt: building.jobFinishesAt.toISOString()
          }
  };
  if (spec.producer) {
    const uncollected = uncollectedOf(island, building);
    const effect = spec.producer[Math.max(0, building.level - 1)];
    view.uncollected = effect ? uncollected[effect.resource] : 0;
  }
  return view;
}

export function armyView(island: Island): Record<string, unknown> {
  return {
    units: unitsOf(island.balances),
    training: island.training.map((batch) => ({
      id: batch.id,
      unit: batch.unit,
      count: batch.count,
      startsAt: batch.startsAt.toISOString(),
      finishesAt: batch.finishesAt.toISOString()
    })),
    housing: { used: housingUsed(island), capacity: housingCapacity(island) }
  };
}

export function villageView(
  island: Island,
  account: AccountRecord,
  underAttack: boolean
): Record<string, unknown> {
  const caps = storageCaps(island);
  const balances = resourcesOf(island.balances);
  const builders = buildersOf(island);
  return {
    id: island.villageId,
    displayName: account.displayName,
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
    buildings: island.buildings.map((building) => buildingView(island, building)),
    resources: {
      brine: { amount: balances.brine, cap: caps.brine },
      peat: { amount: balances.peat, cap: caps.peat },
      copper: { amount: balances.copper, cap: caps.copper }
    },
    saltmark: saltmarkOf(island),
    builders,
    army: armyView(island),
    shield:
      island.shieldEndsAt === null || island.shieldEndsAt.getTime() <= island.now.getTime()
        ? null
        : { endsAt: island.shieldEndsAt.toISOString() },
    underAttack,
    trophies: account.trophies,
    league: leagueFor(account.trophies),
    serverTime: island.now.toISOString()
  };
}

export function ledgerEntryView(row: {
  id: number;
  pair_id: number;
  kind: string;
  asset: string;
  amount: number;
  counterparty_village_id: number | null;
  counterparty_display_name: string | null;
  raid_id: number | null;
  created_at: Date;
}): Record<string, unknown> {
  return {
    id: Number(row.id),
    pairId: Number(row.pair_id),
    kind: row.kind,
    asset: row.asset,
    amount: Number(row.amount),
    counterparty:
      row.counterparty_village_id === null
        ? 'tide'
        : {
            villageId: Number(row.counterparty_village_id),
            displayName: row.counterparty_display_name ?? ''
          },
    raidId: row.raid_id === null ? null : Number(row.raid_id),
    createdAt: row.created_at.toISOString()
  };
}
