import { asNumber, query } from './db.js';
import type { Queryable, Row } from './db.js';
import { GENESIS_DIGEST, firstBrokenSeq, nextDigest, replay } from './domain/history.js';
import type { HistoryEntry, JsonValue, ReplayResult } from './domain/history.js';
import { sequenceBroken } from './http/errors.js';
import { isoMillis, localDate, localTime } from './domain/time.js';
import type { OrderObject, OrderLineObject, ReturnObject } from './views.js';
import type { OrderStatus, ReturnStatus } from './domain/transitions.js';
import type { SessionUser } from './http/context.js';

async function loadEvents(
  orderId: string,
  runner: Queryable | null = null,
): Promise<HistoryEntry[]> {
  const rows = runner
    ? (await runner.query(`SELECT * FROM order_events WHERE order_id = $1 ORDER BY seq`, [orderId]))
        .rows
    : await query(`SELECT * FROM order_events WHERE order_id = $1 ORDER BY seq`, [orderId]);
  return rows.map((row) => ({
    seq: asNumber(row['seq']),
    type: row['type'] as string,
    at: row['at'] as Date,
    data: row['data'] as { [key: string]: JsonValue },
    digest: row['digest'] as string,
  }));
}

/** Reading events, replaying and every transition check the whole chain first. */
export async function assertChain(
  orderId: string,
  runner: Queryable | null = null,
): Promise<HistoryEntry[]> {
  const entries = await loadEvents(orderId, runner);
  const broken = firstBrokenSeq(orderId, entries);
  if (broken !== null) throw sequenceBroken(broken);
  return entries;
}

export async function appendEvent(
  tx: Queryable,
  orderId: string,
  type: string,
  data: { [key: string]: JsonValue },
): Promise<void> {
  const previous = (
    await tx.query(
      `SELECT seq, digest FROM order_events WHERE order_id = $1 ORDER BY seq DESC LIMIT 1`,
      [orderId],
    )
  ).rows[0];
  const seq = previous ? asNumber(previous['seq']) + 1 : 1;
  const previousDigest = previous ? (previous['digest'] as string) : GENESIS_DIGEST;
  const at = (await tx.query(`SELECT now() AS now`)).rows[0]!['now'] as Date;
  const digest = nextDigest(previousDigest, orderId, seq, type, at, data);
  await tx.query(
    `INSERT INTO order_events (order_id, seq, type, at, data, digest) VALUES ($1,$2,$3,$4,$5,$6)`,
    [orderId, seq, type, at, JSON.stringify(data), digest],
  );
}

/** Rebuilds `order_view` and the order summary row from the history entries alone. */
export async function rebuildOrderView(tx: Queryable, orderId: string): Promise<ReplayResult> {
  const entries = await loadEvents(orderId, tx);
  const rebuilt = replay(entries);
  const order = (
    await tx.query(`SELECT operator_id, store_id, number FROM orders WHERE id = $1`, [orderId])
  ).rows[0] as Row;
  await tx.query(
    `INSERT INTO order_view (order_id, operator_id, store_id, number, status, total_cents, refunded_cents, last_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status,
       total_cents = EXCLUDED.total_cents, refunded_cents = EXCLUDED.refunded_cents,
       last_seq = EXCLUDED.last_seq`,
    [
      orderId,
      order['operator_id'],
      order['store_id'],
      order['number'],
      rebuilt.status,
      rebuilt.totalCents,
      rebuilt.refundedCents,
      rebuilt.lastSeq,
    ],
  );
  await tx.query(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, rebuilt.status]);
  return rebuilt;
}

export async function replayOf(orderId: string): Promise<ReplayResult> {
  const entries = await assertChain(orderId);
  return replay(entries);
}

export type OrderRecord = {
  id: string;
  operatorId: string;
  storeId: string;
  storeName: string;
  timezone: string;
  userId: string;
  number: string;
  status: OrderStatus;
  slotStartUtc: Date;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  vatCents: number;
  createdAt: Date;
};

const ORDER_SELECT = `
  SELECT o.*, s.name AS store_name, s.timezone,
         COALESCE(v.refunded_cents, 0) AS refunded_cents
    FROM orders o JOIN stores s ON s.id = o.store_id
    LEFT JOIN order_view v ON v.order_id = o.id`;

function toOrderRecord(row: Row): OrderRecord {
  return {
    id: row['id'] as string,
    operatorId: row['operator_id'] as string,
    storeId: row['store_id'] as string,
    storeName: row['store_name'] as string,
    timezone: row['timezone'] as string,
    userId: row['user_id'] as string,
    number: row['number'] as string,
    status: row['status'] as OrderStatus,
    slotStartUtc: row['slot_start_utc'] as Date,
    customerName: row['customer_name'] as string,
    customerEmail: row['customer_email'] as string,
    totalCents: asNumber(row['total_cents']),
    vatCents: asNumber(row['vat_cents']),
    createdAt: row['created_at'] as Date,
  };
}

export async function loadOrderRecord(
  operatorId: string,
  orderId: string,
): Promise<OrderRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const rows = await query(`${ORDER_SELECT} WHERE o.id = $1 AND o.operator_id = $2`, [
    orderId,
    operatorId,
  ]);
  const row = rows[0];
  return row ? toOrderRecord(row) : null;
}

/** Shoppers see their own orders, managers their shops', leads and care all of them. */
export function maySeeOrder(session: SessionUser, order: OrderRecord): boolean {
  if (session.role === 'shopper') return order.userId === session.userId;
  if (session.role === 'manager') return session.storeIds.includes(order.storeId);
  return true;
}

export async function orderLines(
  orderId: string,
  runner: Queryable | null = null,
): Promise<OrderLineObject[]> {
  const run = runner
    ? async (text: string, values: unknown[]) => (await runner.query(text, values)).rows
    : query;
  const lines = await run(
    `SELECT l.*, COALESCE(r.returned, 0) AS returned_quantity FROM order_lines l
       LEFT JOIN (
         SELECT rl.sku, sum(rl.quantity) AS returned
           FROM return_lines rl JOIN returns rt ON rt.id = rl.return_id
          WHERE rt.order_id = $1 AND rt.status <> 'declined'
          GROUP BY rl.sku
       ) r ON r.sku = l.sku
      WHERE l.order_id = $1 ORDER BY l.sku`,
    [orderId],
  );
  return lines.map((line) => ({
    sku: line['sku'] as string,
    name: line['name'] as string,
    quantity: asNumber(line['quantity']),
    unit_price_milli: asNumber(line['unit_price_milli']),
    line_total_cents: asNumber(line['line_total_cents']),
    vat_rate: asNumber(line['vat_rate']),
    vat_cents: asNumber(line['vat_cents']),
    returned_quantity: asNumber(line['returned_quantity']),
  }));
}

export async function orderObjectOf(
  order: OrderRecord,
  runner: Queryable | null = null,
): Promise<OrderObject> {
  const lines = await orderLines(order.id, runner);
  const run = runner
    ? async (text: string, values: unknown[]) => (await runner.query(text, values)).rows
    : query;
  const refunded = (
    await run(
      `SELECT COALESCE(sum(refund_cents), 0) AS refunded FROM returns
        WHERE order_id = $1 AND status = 'settled'`,
      [order.id],
    )
  )[0];
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    store_id: order.storeId,
    store_name: order.storeName,
    timezone: order.timezone,
    slot_start_utc: isoMillis(order.slotStartUtc),
    slot_local_date: localDate(order.timezone, order.slotStartUtc),
    slot_local_time: localTime(order.timezone, order.slotStartUtc),
    customer: { name: order.customerName, email: order.customerEmail },
    lines,
    total_cents: order.totalCents,
    vat_cents: order.vatCents,
    refunded_cents: asNumber(refunded?.['refunded'] ?? 0),
    created_at: isoMillis(order.createdAt),
  };
}

export function toReturnObject(row: Row, lines: Row[]): ReturnObject {
  return {
    id: row['id'] as string,
    number: row['number'] as string,
    order_id: row['order_id'] as string,
    status: row['status'] as ReturnStatus,
    lines: lines.map((line) => ({
      sku: line['sku'] as string,
      quantity: asNumber(line['quantity']),
      refund_cents: asNumber(line['refund_cents']),
    })),
    refund_cents: asNumber(row['refund_cents']),
    reason: row['reason'] as string,
    created_at: isoMillis(row['created_at'] as Date),
  };
}

export async function loadReturnWithOrder(
  operatorId: string,
  returnId: string,
): Promise<{ returnRow: Row; order: OrderRecord } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(returnId)) return null;
  const rows = await query(
    `SELECT rt.* FROM returns rt JOIN orders o ON o.id = rt.order_id
      WHERE rt.id = $1 AND o.operator_id = $2`,
    [returnId, operatorId],
  );
  const row = rows[0];
  if (!row) return null;
  const order = await loadOrderRecord(operatorId, row['order_id'] as string);
  return order ? { returnRow: row, order } : null;
}
