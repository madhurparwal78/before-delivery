import { rows, one } from "../db.ts";
import type { Pool } from "../db.ts";
import type { OrderRow } from "../store.ts";
import { loadOrderContext, type OrderContext, type SessionUser } from "../store.ts";
import { ORDER_LABELS, type OrderStatus } from "../domain/states.ts";

/** The order ids a caller may see. Drafts are visible only to the broker. */
export async function visibleOrderIds(pool: Pool, actor: SessionUser): Promise<string[]> {
  if (actor.role === "broker") {
    const result = await rows<{ id: string }>(pool, "SELECT id FROM orders ORDER BY created_at, id");
    return result.map((r) => r.id);
  }
  if (actor.role === "grower") {
    const result = await rows<{ id: string }>(pool, "SELECT id FROM orders WHERE grower_id = $1 AND status <> 'draft' ORDER BY created_at, id", [actor.id]);
    return result.map((r) => r.id);
  }
  const result = await rows<{ id: string }>(pool, `SELECT id FROM orders WHERE status = 'open' OR id IN (SELECT order_id FROM drops WHERE beekeeper_id = $1) ORDER BY created_at, id`, [actor.id]);
  return result.map((r) => r.id);
}

export async function loadVisibleOrderContexts(pool: Pool, actor: SessionUser): Promise<OrderContext[]> {
  const ids = await visibleOrderIds(pool, actor);
  const contexts: OrderContext[] = [];
  for (const id of ids) {
    const context = await loadOrderContext(pool, id);
    if (context) contexts.push(context);
  }
  return contexts;
}

export function orderStatusLabel(order: OrderRow): string {
  if (order.status === "inspected" && order.settlement_status === "queued") return "Settlement queued";
  return ORDER_LABELS[order.status as OrderStatus];
}

export async function loadOrderRow(pool: Pool, orderId: string): Promise<OrderRow | null> {
  return one<OrderRow>(pool, "SELECT * FROM orders WHERE id = $1", [orderId]);
}
