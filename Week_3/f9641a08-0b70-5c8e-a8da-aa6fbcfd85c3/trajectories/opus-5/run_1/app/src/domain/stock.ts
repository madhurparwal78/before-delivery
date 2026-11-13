import { randomUUID } from 'node:crypto';
import { Db } from '../db/pool';
import { LOCATIONS, Location } from './constants';

export type StockAccount = 'external' | 'available' | 'reserved' | 'committed' | 'dispatched';

export type MovementReason =
  | 'stock_received'
  | 'stock_adjusted'
  | 'hold_placed'
  | 'hold_released'
  | 'hold_lapsed'
  | 'order_committed'
  | 'order_cancelled'
  | 'shipped'
  | 'return_received'
  | 'trial_returned'
  | 'exchange_committed'
  | 'replacement_committed';

const FLOWS: Record<MovementReason, [StockAccount, StockAccount]> = {
  stock_received: ['external', 'available'],
  stock_adjusted: ['available', 'external'],
  hold_placed: ['available', 'reserved'],
  hold_released: ['reserved', 'available'],
  hold_lapsed: ['reserved', 'available'],
  order_committed: ['reserved', 'committed'],
  order_cancelled: ['committed', 'available'],
  shipped: ['committed', 'dispatched'],
  return_received: ['dispatched', 'available'],
  trial_returned: ['dispatched', 'available'],
  exchange_committed: ['available', 'committed'],
  replacement_committed: ['available', 'committed']
};

export async function writeMovement(
  client: Db,
  variantId: string,
  reason: MovementReason,
  ref: string,
  location: Location,
  quantity: number
): Promise<string> {
  if (quantity <= 0) throw new Error('movement quantity must be positive');
  const [from, to] = FLOWS[reason];
  const movementId = randomUUID();
  await client.query(
    'INSERT INTO stock_movements (id, variant_id, reason, ref) VALUES ($1, $2, $3, $4)',
    [movementId, variantId, reason, ref]
  );
  await client.query(
    `INSERT INTO stock_entries (movement_id, variant_id, account, location, quantity)
     VALUES ($1, $2, $3, $4, $5), ($1, $2, $6, $4, $7)`,
    [movementId, variantId, from, location, -quantity, to, quantity]
  );
  return movementId;
}

export async function writeMovementDirect(
  client: Db,
  variantId: string,
  reason: string,
  ref: string,
  location: Location,
  quantity: number,
  from: StockAccount,
  to: StockAccount
): Promise<string> {
  const movementId = randomUUID();
  await client.query(
    'INSERT INTO stock_movements (id, variant_id, reason, ref) VALUES ($1, $2, $3, $4)',
    [movementId, variantId, reason, ref]
  );
  await client.query(
    `INSERT INTO stock_entries (movement_id, variant_id, account, location, quantity)
     VALUES ($1, $2, $3, $4, $5), ($1, $2, $6, $4, $7)`,
    [movementId, variantId, from, location, -quantity, to, quantity]
  );
  return movementId;
}

export type LocationBalances = {
  location: Location;
  available: number;
  reserved: number;
  committed: number;
  dispatched: number;
  on_hand: number;
};

export async function lockVariants(client: Db, variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const unique = [...new Set(variantIds)].sort();
  await client.query('SELECT id FROM variants WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [unique]);
}

export async function balancesFor(client: Db, variantIds: string[]): Promise<Map<string, LocationBalances[]>> {
  const result = new Map<string, LocationBalances[]>();
  if (variantIds.length === 0) return result;
  const rows = await client.query<{ variant_id: string; account: string; location: string; total: string }>(
    `SELECT variant_id, account, location, sum(quantity)::bigint AS total
     FROM stock_entries WHERE variant_id = ANY($1::uuid[])
     GROUP BY variant_id, account, location`,
    [[...new Set(variantIds)]]
  );
  for (const variantId of new Set(variantIds)) {
    result.set(
      variantId,
      LOCATIONS.map((location) => ({
        location,
        available: 0,
        reserved: 0,
        committed: 0,
        dispatched: 0,
        on_hand: 0
      }))
    );
  }
  for (const row of rows) {
    const list = result.get(row.variant_id);
    if (!list) continue;
    const entry = list.find((item) => item.location === row.location);
    if (!entry) continue;
    const total = Number(row.total);
    if (row.account === 'available') entry.available = total;
    if (row.account === 'reserved') entry.reserved = total;
    if (row.account === 'committed') entry.committed = total;
    if (row.account === 'dispatched') entry.dispatched = total;
  }
  for (const list of result.values()) {
    for (const entry of list) entry.on_hand = entry.available + entry.reserved;
  }
  return result;
}

export async function availableMap(client: Db, variantIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (variantIds.length === 0) return map;
  for (const variantId of variantIds) map.set(variantId, 0);
  const rows = await client.query<{ variant_id: string; total: string }>(
    `SELECT variant_id, sum(quantity)::bigint AS total FROM stock_entries
     WHERE variant_id = ANY($1::uuid[]) AND account = 'available' GROUP BY variant_id`,
    [[...new Set(variantIds)]]
  );
  for (const row of rows) map.set(row.variant_id, Number(row.total));
  return map;
}

export async function availableByLocation(client: Db, variantId: string): Promise<Record<Location, number>> {
  const rows = await client.query<{ location: string; total: string }>(
    `SELECT location, sum(quantity)::bigint AS total FROM stock_entries
     WHERE variant_id = $1 AND account = 'available' GROUP BY location`,
    [variantId]
  );
  const out: Record<Location, number> = { bhiwandi: 0, gurugram: 0 };
  for (const row of rows) {
    if (row.location === 'bhiwandi' || row.location === 'gurugram') out[row.location] = Number(row.total);
  }
  return out;
}

export async function accountByLocation(
  client: Db,
  variantId: string,
  account: StockAccount
): Promise<Record<Location, number>> {
  const rows = await client.query<{ location: string; total: string }>(
    `SELECT location, sum(quantity)::bigint AS total FROM stock_entries
     WHERE variant_id = $1 AND account = $2 GROUP BY location`,
    [variantId, account]
  );
  const out: Record<Location, number> = { bhiwandi: 0, gurugram: 0 };
  for (const row of rows) {
    if (row.location === 'bhiwandi' || row.location === 'gurugram') out[row.location] = Number(row.total);
  }
  return out;
}

export function pickLocation(byLocation: Record<Location, number>): Location {
  return byLocation.bhiwandi >= byLocation.gurugram ? 'bhiwandi' : 'gurugram';
}

export async function drawFromAccount(
  client: Db,
  variantId: string,
  reason: MovementReason,
  ref: string,
  quantity: number,
  sourceAccount: StockAccount
): Promise<void> {
  const byLocation = await accountByLocation(client, variantId, sourceAccount);
  let left = quantity;
  const order: Location[] = byLocation.bhiwandi >= byLocation.gurugram ? ['bhiwandi', 'gurugram'] : ['gurugram', 'bhiwandi'];
  for (const location of order) {
    if (left === 0) break;
    const take = Math.min(left, byLocation[location]);
    if (take > 0) {
      await writeMovement(client, variantId, reason, ref, location, take);
      left -= take;
    }
  }
  if (left > 0) {
    await writeMovement(client, variantId, reason, ref, order[0], left);
  }
}
