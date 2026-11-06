import { money } from '../../shared/money.js';
import type { Cadence, OrderStatus, SubscriptionState } from '../../shared/types.js';
import { db } from '../db/pool.js';
import type { ApiResponse, RequestContext } from '../http/context.js';
import { errors } from '../http/errors.js';
import { loadOrder, serializeOrder } from '../repo/orders.js';
import { loadSubscription, serializeSubscription } from '../repo/subscriptions.js';
import { requireCustomer } from './sessions.js';

export async function getAccount(ctx: RequestContext): Promise<ApiResponse> {
  const customer = requireCustomer(ctx);
  const orders = await db.query<{
    number: string;
    placed_at: Date;
    total_cents: number;
    status: OrderStatus;
  }>(
    `SELECT number, placed_at, total_cents, status FROM orders
      WHERE customer_id = $1 ORDER BY placed_at DESC, number DESC`,
    [customer.id],
  );
  const subscriptions = await db.query<{
    number: string;
    state: SubscriptionState;
    scent: string;
    cadence: Cadence;
    next_bill_date: string | null;
  }>(
    `SELECT number, state, scent, cadence, next_bill_date FROM subscriptions
      WHERE customer_id = $1 ORDER BY number`,
    [customer.id],
  );
  return {
    status: 200,
    body: {
      customer: { email: customer.email, locale: customer.locale },
      orders: orders.rows.map((row) => ({
        number: row.number,
        placed_at: row.placed_at.toISOString(),
        total: money(row.total_cents),
        status: row.status,
      })),
      subscriptions: subscriptions.rows.map((row) => ({
        number: row.number,
        state: row.state,
        scent: row.scent,
        cadence: row.cadence,
        next_bill_date: row.next_bill_date,
      })),
    },
  };
}

export async function getOwnOrder(ctx: RequestContext): Promise<ApiResponse> {
  const customer = requireCustomer(ctx);
  const record = await loadOrder(db, ctx.params['number'] ?? '');
  if (!record || record.row.customer_id !== customer.id) throw errors.notFound();
  return { status: 200, body: serializeOrder(record) };
}

export async function getOwnSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const customer = requireCustomer(ctx);
  const row = await loadSubscription(db, ctx.params['number'] ?? '');
  if (!row || row.customer_id !== customer.id) throw errors.notFound();
  return { status: 200, body: serializeSubscription(row, new Date()) };
}
