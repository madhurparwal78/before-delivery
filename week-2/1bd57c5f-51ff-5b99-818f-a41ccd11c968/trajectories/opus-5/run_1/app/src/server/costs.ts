import { TRADE_KEYS, type Trade } from '../shared/domain.js';
import { contingencyAmount, formatMoney, lineTotal } from './core/money.js';
import type { Queryable } from './db.js';
import { loadItems, loadRooms } from './model.js';

export type CostsView = {
  as_of: string;
  by_room: { room_id: string; name: string; subtotal: string }[];
  by_trade: { trade: Trade | null; subtotal: string }[];
  items_subtotal: string;
  change_orders_total: string;
  contingency_percent: string;
  contingency: string;
  total: string;
};

/** The one cost rollup: item line totals, approved change orders and one contingency. */
export async function computeCosts(
  tx: Queryable,
  jobId: string,
  asOf: Date,
): Promise<CostsView> {
  const rooms = await loadRooms(tx, jobId);
  const items = await loadItems(tx, jobId);

  const perRoom = new Map<string, bigint>();
  const perTrade = new Map<Trade | null, bigint>();
  let itemsSubtotal = 0n;
  for (const item of items) {
    const total = lineTotal(item.quantity, item.unitCost);
    itemsSubtotal += total;
    perRoom.set(item.roomId, (perRoom.get(item.roomId) ?? 0n) + total);
    perTrade.set(item.trade, (perTrade.get(item.trade) ?? 0n) + total);
  }

  const approved = await tx.query(
    `select coalesce(sum(amount), 0) as total from change_orders
      where job_id = $1 and approved_at is not null and approved_at <= $2`,
    [jobId, asOf.toISOString()],
  );
  const changeOrdersTotal = BigInt(approved.rows[0].total as string);

  const setting = await tx.query(
    `select percent from contingency_settings
      where job_id = $1 and effective_at <= $2
      order by effective_at desc, id desc limit 1`,
    [jobId, asOf.toISOString()],
  );
  const percent = setting.rows.length === 0 ? 0n : BigInt(setting.rows[0].percent as string);

  const base = itemsSubtotal + changeOrdersTotal;
  const contingency = contingencyAmount(base, percent);

  return {
    as_of: asOf.toISOString(),
    by_room: rooms.map((room) => ({
      room_id: room.id,
      name: room.name,
      subtotal: formatMoney(perRoom.get(room.id) ?? 0n)!,
    })),
    by_trade: [...TRADE_KEYS, null].map((trade) => ({
      trade,
      subtotal: formatMoney(perTrade.get(trade) ?? 0n)!,
    })),
    items_subtotal: formatMoney(itemsSubtotal)!,
    change_orders_total: formatMoney(changeOrdersTotal)!,
    contingency_percent: formatMoney(percent)!,
    contingency: formatMoney(contingency)!,
    total: formatMoney(base + contingency)!,
  };
}
