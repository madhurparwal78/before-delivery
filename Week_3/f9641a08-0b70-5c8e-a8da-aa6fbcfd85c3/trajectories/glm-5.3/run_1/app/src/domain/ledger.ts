import type { Client } from '../db/pool.js';

export const LOCATIONS = ['bhiwandi', 'gurugram'] as const;
export type Location = (typeof LOCATIONS)[number];

export type StockReason =
  | 'stock_received' | 'stock_adjusted' | 'hold_placed' | 'hold_released' | 'hold_lapsed'
  | 'order_committed' | 'order_cancelled' | 'shipped' | 'return_received' | 'trial_returned'
  | 'exchange_committed' | 'replacement_committed';

const FLOWS: Record<StockReason, { from: string; to: string }> = {
  stock_received: { from: 'external', to: 'available' },
  stock_adjusted: { from: 'available', to: 'external' },
  hold_placed: { from: 'available', to: 'reserved' },
  hold_released: { from: 'reserved', to: 'available' },
  hold_lapsed: { from: 'reserved', to: 'available' },
  order_committed: { from: 'reserved', to: 'committed' },
  order_cancelled: { from: 'committed', to: 'available' },
  shipped: { from: 'committed', to: 'dispatched' },
  return_received: { from: 'dispatched', to: 'available' },
  trial_returned: { from: 'dispatched', to: 'available' },
  exchange_committed: { from: 'available', to: 'committed' },
  replacement_committed: { from: 'available', to: 'committed' },
};

/** Writes one movement as two matching entries that sum to zero. */
export async function moveStock(
  client: Client,
  reason: StockReason,
  ref: string,
  entries: { sku: string; location: Location; quantity: number }[],
): Promise<void> {
  const flow = FLOWS[reason];
  const movement = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (reason, ref) VALUES ($1, $2) RETURNING id`, [reason, ref]);
  const movementId = movement.rows[0].id;
  const values: unknown[] = [];
  const tuples: string[] = [];
  let i = 0;
  for (const entry of entries) {
    if (entry.quantity === 0) continue;
    values.push(movementId, entry.sku, entry.location, flow.from, -entry.quantity);
    tuples.push(`($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`);
    i += 1;
    values.push(movementId, entry.sku, entry.location, flow.to, entry.quantity);
    tuples.push(`($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`);
    i += 1;
  }
  if (tuples.length === 0) return;
  await client.query(
    `INSERT INTO stock_entries (movement_id, sku, location, account, quantity) VALUES ${tuples.join(', ')}`,
    values,
  );
}

export type StockFigures = { sku: string; location: Location; available: number; reserved: number; committed: number; on_hand: number };

export async function stockFigures(client: Client, skus: string[]): Promise<Map<string, StockFigures[]>> {
  const map = new Map<string, StockFigures[]>();
  if (skus.length === 0) return map;
  const res = await client.query<{ sku: string; location: Location; available: string; reserved: string; committed: string }>(`
    SELECT e.sku, e.location,
      COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'available'), 0)::TEXT AS available,
      COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'reserved'), 0)::TEXT AS reserved,
      COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'committed'), 0)::TEXT AS committed
    FROM stock_entries e
    WHERE e.sku = ANY($1)
    GROUP BY e.sku, e.location`, [skus]);
  for (const row of res.rows) {
    const available = Number(row.available);
    const reserved = Number(row.reserved);
    const committed = Number(row.committed);
    const list = map.get(row.sku) ?? [];
    list.push({ sku: row.sku, location: row.location, available, reserved, committed, on_hand: available + reserved });
    map.set(row.sku, list);
  }
  return map;
}

export async function availableOf(client: Client, sku: string): Promise<number> {
  const res = await client.query<{ available: string }>(`
    SELECT COALESCE(SUM(quantity), 0)::TEXT AS available FROM stock_entries
    WHERE sku = $1 AND account = 'available'`, [sku]);
  return Number(res.rows[0].available);
}

export async function availableFor(client: Client, skus: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (skus.length === 0) return map;
  const res = await client.query<{ sku: string; available: string }>(`
    SELECT sku, COALESCE(SUM(quantity), 0)::TEXT AS available FROM stock_entries
    WHERE sku = ANY($1) AND account = 'available' GROUP BY sku`, [skus]);
  for (const row of res.rows) map.set(row.sku, Number(row.available));
  return map;
}

/** The location with the most available, ties to bhiwandi. */
export function pickLocation(entries: { location: Location; available: number }[], quantity: number): { location: Location; take: number }[] {
  const ordered = [...entries].sort((a, b) => (b.available - a.available) || (a.location === 'bhiwandi' ? -1 : 1));
  const plan: { location: Location; take: number }[] = [];
  let remaining = quantity;
  for (const entry of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(entry.available, remaining);
    if (take > 0) {
      plan.push({ location: entry.location, take });
      remaining -= take;
    }
  }
  return plan;
}
