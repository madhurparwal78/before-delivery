import type { Queryable } from '../db.js';
import type { LedgerAsset, LedgerKind, ResourceAmounts, UnitCounts } from '../../shared/types.js';
import { RESOURCES, UNIT_KEYS } from '../../shared/types.js';

export type Balances = ResourceAmounts & UnitCounts;

export type Movement = {
  kind: LedgerKind;
  asset: LedgerAsset;
  amount: number;
  fromVillageId: number | null;
  toVillageId: number | null;
  raidId?: number | null;
  at: Date;
};

export async function movePair(client: Queryable, movement: Movement): Promise<number> {
  const { rows } = await client.query<{ pair_id: string }>(
    "SELECT nextval('ledger_pair_seq') AS pair_id"
  );
  const pairId = Number(rows[0]?.pair_id);
  const raidId = movement.raidId ?? null;
  await client.query(
    `INSERT INTO ledger_entries
       (pair_id, village_id, kind, asset, amount, counterparty_village_id, raid_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($1, $6, $3, $4, $9, $2, $7, $8)`,
    [
      pairId,
      movement.toVillageId,
      movement.kind,
      movement.asset,
      movement.amount,
      movement.fromVillageId,
      raidId,
      movement.at.toISOString(),
      -movement.amount
    ]
  );
  return pairId;
}

export async function moveResources(
  client: Queryable,
  base: Omit<Movement, 'asset' | 'amount'>,
  amounts: ResourceAmounts
): Promise<void> {
  for (const resource of RESOURCES) {
    const amount = amounts[resource];
    if (amount === 0) continue;
    await movePair(client, { ...base, asset: resource, amount });
  }
}

export async function readBalances(client: Queryable, villageId: number): Promise<Balances> {
  const { rows } = await client.query<{ asset: string; total: number }>(
    'SELECT asset, SUM(amount)::bigint AS total FROM ledger_entries WHERE village_id = $1 GROUP BY asset',
    [villageId]
  );
  const balances: Balances = {
    brine: 0,
    peat: 0,
    copper: 0,
    saltjack: 0,
    peat_slinger: 0
  };
  for (const row of rows) {
    const asset = row.asset as LedgerAsset;
    balances[asset] = Number(row.total);
  }
  return balances;
}

export function resourcesOf(balances: Balances): ResourceAmounts {
  return { brine: balances.brine, peat: balances.peat, copper: balances.copper };
}

export function unitsOf(balances: Balances): UnitCounts {
  return { saltjack: balances.saltjack, peat_slinger: balances.peat_slinger };
}

export function totalUnits(units: UnitCounts): number {
  return UNIT_KEYS.reduce((total, unit) => total + units[unit], 0);
}
