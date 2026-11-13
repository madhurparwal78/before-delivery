import { db, tx } from '../db/pool';
import { invalidTransition, notFound } from '../errors';
import { requireUser } from '../http/context';
import { sendJson } from '../http/respond';
import { route } from '../http/router';
import { publishStockFor } from '../domain/events';
import { orderStatusSubject, recordNotification, statusBody } from '../domain/notify';
import {
  OrderRow,
  addTimeline,
  issueRefund,
  loadOrder,
  loadOrderLines,
  orderPayload,
  publishOrder
} from '../domain/orders';
import { ORDER_STATUS_WORDS, canCancelOrder } from '../domain/rules';
import { drawFromAccount, lockVariants } from '../domain/stock';
import { Db } from '../db/pool';

export async function cancelOrderRecord(client: Db, order: OrderRow): Promise<OrderRow> {
  if (!canCancelOrder(order.status)) throw invalidTransition();
  const now = new Date();
  const lines = await loadOrderLines(client, order.number);
  await lockVariants(client, lines.map((line) => line.variant_id));
  for (const line of lines) {
    await drawFromAccount(client, line.variant_id, 'order_cancelled', order.number, line.quantity, 'committed');
    await client.query("UPDATE order_lines SET fulfillment = 'cancelled' WHERE id = $1", [line.id]);
  }

  const outstanding = order.payment_amount - order.refunded;
  await issueRefund(client, order, outstanding, 'cancellation', order.number);

  if (order.discount_code !== null) {
    await client.query('UPDATE discount_codes SET used = greatest(used - 1, 0) WHERE code = $1', [
      order.discount_code
    ]);
  }

  await client.query(
    "UPDATE orders SET status = 'cancelled', version = version + 1 WHERE number = $1",
    [order.number]
  );
  await addTimeline(client, order.number, 'cancelled', now);

  const subject = orderStatusSubject(order.number, 'cancelled');
  await recordNotification(
    client,
    order.user_id,
    subject,
    statusBody(`Order ${order.number}`, ORDER_STATUS_WORDS.cancelled, outstanding > 0 ? outstanding : null),
    'pending'
  );

  await publishStockFor(client, lines.map((line) => line.variant_id));
  const updated = await loadOrder(client, order.number);
  await publishOrder(client, updated!);
  return updated!;
}

export function registerOrderRoutes(): void {
  route('GET', '/api/orders', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await db.query<{ number: string; status: string; placed_at: Date; totals: { total: number } }>(
      'SELECT number, status, placed_at, totals FROM orders WHERE user_id = $1 ORDER BY placed_at DESC, number DESC',
      [user.id]
    );
    sendJson(
      ctx,
      200,
      rows.map((row) => ({
        number: row.number,
        status: row.status,
        placed_at: row.placed_at.toISOString(),
        total: row.totals.total
      }))
    );
  });

  route('GET', '/api/orders/:number', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const order = await loadOrder(db, ctx.params.number);
    if (order === null || order.user_id !== user.id) throw notFound();
    sendJson(ctx, 200, await orderPayload(db, order, new Date()));
  });

  route('POST', '/api/orders/:number/cancel', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const payload = await tx(async (client) => {
      const order = await client.one<OrderRow>('SELECT * FROM orders WHERE number = $1 FOR UPDATE', [
        ctx.params.number
      ]);
      if (order === null || order.user_id !== user.id) throw notFound();
      const updated = await cancelOrderRecord(client, order);
      return orderPayload(client, updated, new Date());
    });
    sendJson(ctx, 200, payload);
  });
}
