import type { PoolClient } from 'pg';
import { apiError } from '../http/errors';
import type { Actor } from '../http/router';
import { pool, type Queryable } from '../db';
import { loadOrderAggregate, type OrderAggregate } from './orders';
import { canSeeOrder } from './visibility';

/** The order as the caller may see it, or 404 when it is not theirs to see. */
export async function requireVisibleOrder(
  client: Queryable,
  actor: Actor,
  orderId: string,
): Promise<OrderAggregate> {
  if (!(await canSeeOrder(client, actor, orderId))) throw apiError.notFound();
  const order = await loadOrderAggregate(client, orderId);
  if (order === null) throw apiError.notFound();
  return order;
}

/** Locks the order row so that one decision at a time is made about it. */
export async function lockOrder(client: PoolClient, orderId: string): Promise<OrderAggregate> {
  const locked = await client.query('select id from orders where id = $1 for update', [orderId]);
  if (locked.rows.length === 0) throw apiError.notFound();
  const order = await loadOrderAggregate(client, orderId);
  if (order === null) throw apiError.notFound();
  return order;
}

export async function loadOrder(orderId: string): Promise<OrderAggregate> {
  const order = await loadOrderAggregate(pool, orderId);
  if (order === null) throw apiError.notFound();
  return order;
}
