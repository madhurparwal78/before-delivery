// The paired resource ledger. Every movement of a resource or unit is one pair of two rows with
// opposite amounts and one pairId; the other side is another island or the tide.
import type { PoolClient } from 'pg';
import type { AssetKey, LedgerKind, ResourceAmounts } from '../domain/types.ts';

export interface Balances {
  brine: number;
  peat: number;
  copper: number;
  saltjack: number;
  peat_slinger: number;
}

export const emptyBalances = (): Balances => ({ brine: 0, peat: 0, copper: 0, saltjack: 0, peat_slinger: 0 });

export async function balancesOf(client: PoolClient, villageId: number): Promise<Balances> {
  const result = await client.query<{ asset: string; total: string }>(
    'SELECT asset, SUM(amount)::bigint AS total FROM ledger WHERE village_id = $1 GROUP BY asset',
    [villageId]
  );
  const balances = emptyBalances();
  for (const row of result.rows) {
    (balances as Record<AssetKey, number>)[row.asset as AssetKey] = Number(row.total);
  }
  return balances;
}

async function nextPairId(client: PoolClient): Promise<number> {
  const result = await client.query<{ nextval: string }>('SELECT nextval($1) AS nextval', ['ledger_pair_seq']);
  return Number(result.rows[0].nextval);
}

// A movement between an island and the tide (the world account). amount is signed for the island.
export async function tidePair(
  client: PoolClient,
  villageId: number,
  kind: LedgerKind,
  asset: AssetKey,
  amount: number,
  createdAt: number,
  raidId: number | null = null
): Promise<void> {
  const pairId = await nextPairId(client);
  await client.query(
    `INSERT INTO ledger (pair_id, village_id, kind, asset, amount, counterparty_kind, counterparty_village_id, raid_id, created_at)
     VALUES ($1, $2, $3, $4, $5, 'tide', NULL, $6, $7), ($1, NULL, $3, $4, $8, 'tide', NULL, $6, $7)`,
    [pairId, villageId, kind, asset, amount, raidId, createdAt, -amount]
  );
}

// A movement from one island to another: a debit here and an equal credit there.
export async function islandPair(
  client: PoolClient,
  fromVillageId: number,
  toVillageId: number,
  kind: LedgerKind,
  asset: AssetKey,
  amount: number,
  createdAt: number,
  raidId: number | null = null
): Promise<void> {
  const pairId = await nextPairId(client);
  await client.query(
    `INSERT INTO ledger (pair_id, village_id, kind, asset, amount, counterparty_kind, counterparty_village_id, raid_id, created_at)
     VALUES ($1, $2, $3, $4, $5, 'village', $6, $7, $8), ($1, $6, $3, $4, $9, 'village', $2, $7, $8)`,
    [pairId, fromVillageId, kind, asset, -amount, toVillageId, raidId, createdAt, amount]
  );
}

// Credits amounts capped by storage room; reports what was lost. Writes one tide pair per resource.
export async function creditCapped(
  client: PoolClient,
  villageId: number,
  kind: LedgerKind,
  amounts: ResourceAmounts,
  balances: Balances,
  caps: ResourceAmounts,
  createdAt: number,
  raidId: number | null = null
): Promise<{ credited: ResourceAmounts; lost: ResourceAmounts }> {
  const credited: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
  const lost: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
  for (const resource of ['brine', 'peat', 'copper'] as const) {
    const amount = amounts[resource];
    if (amount <= 0) continue;
    const room = Math.max(0, caps[resource] - balances[resource]);
    const part = Math.min(amount, room);
    if (part > 0) {
      await tidePair(client, villageId, kind, resource, part, createdAt, raidId);
      credited[resource] = part;
      balances[resource] += part;
    }
    lost[resource] = amount - part;
  }
  return { credited, lost };
}

// Debits full amounts from an island to the tide, refusing the change when a balance is short.
export async function debitExact(
  client: PoolClient,
  villageId: number,
  kind: LedgerKind,
  amounts: ResourceAmounts,
  balances: Balances,
  createdAt: number
): Promise<boolean> {
  for (const resource of ['brine', 'peat', 'copper'] as const) {
    if (balances[resource] < amounts[resource]) return false;
  }
  for (const resource of ['brine', 'peat', 'copper'] as const) {
    if (amounts[resource] > 0) {
      await tidePair(client, villageId, kind, resource, -amounts[resource], createdAt);
      balances[resource] -= amounts[resource];
    }
  }
  return true;
}
