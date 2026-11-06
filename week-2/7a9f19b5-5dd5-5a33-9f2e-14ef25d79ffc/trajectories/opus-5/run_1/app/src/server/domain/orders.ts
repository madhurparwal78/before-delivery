/**
 * Orders: the order key, cart repricing, the clearance stock reservation and the
 * order projection. The state machine itself lives in `shared/orderState.ts`.
 */

import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, row, rows } from "../db/pool.js";
import { totalsFor } from "../../shared/gst.js";
import { DISPLAY_STATUS, isOpenCart, type StoredOrderStatus } from "../../shared/orderState.js";
import { isOverdue, type IsoDate } from "../../shared/dates.js";
import { ORDER_KEY_ALPHABET, ORDER_KEY_LENGTH } from "../../shared/domain.js";
import { unitPriceCentsFor } from "../../shared/projection.js";
import type { Order, OrderLine, OrderStatus, PaymentMethod, PriceTier, Refund } from "../../shared/types.js";
import { insufficientStock } from "../http/errors.js";

export interface OrderRow {
  id: string;
  order_key: string;
  user_id: string;
  status: StoredOrderStatus;
  payment_method: PaymentMethod;
  price_tier: PriceTier;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  captured_cents: number;
  refunded_cents: number;
  card_last4: string | null;
  purchase_order: string | null;
  kb_payment_id: string | null;
  kb_invoice_id: string | null;
  invoice_number: string | null;
  invoice_date: Date | string | null;
  due_date: Date | string | null;
  confirmation_sent_at: Date | null;
  created_at: Date;
}

interface OrderLineRow {
  variant_code: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  clearance: boolean;
}

interface RefundRow {
  id: string;
  amount_cents: number;
  reason: string;
  kb_transaction_id: string;
  created_at: Date;
}

export interface LoadedOrder {
  record: OrderRow;
  lines: OrderLineRow[];
  refunds: RefundRow[];
}

/** `LF-` followed by 8 characters from the published alphabet. */
export function generateOrderKey(): string {
  let key = "";
  for (let i = 0; i < ORDER_KEY_LENGTH; i += 1) {
    key += ORDER_KEY_ALPHABET[randomInt(ORDER_KEY_ALPHABET.length)];
  }
  return `LF-${key}`;
}

function toIsoDate(value: Date | string | null): IsoDate | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

const LINE_SQL = `
  SELECT ol.variant_code, p.name AS product_name, ol.quantity, ol.unit_price_cents, v.clearance
  FROM order_lines ol
  JOIN variants v ON v.code = ol.variant_code
  JOIN products p ON p.slug = v.product_slug
  WHERE ol.order_id = $1
  ORDER BY ol.added_at, ol.variant_code
`;

export async function loadOrderByKey(orderKey: string): Promise<LoadedOrder | null> {
  const record = await queryOne<OrderRow>("SELECT * FROM orders WHERE order_key = $1", [orderKey]);
  if (!record) return null;
  return {
    record,
    lines: await query<OrderLineRow>(LINE_SQL, [record.id]),
    refunds: await query<RefundRow>(
      "SELECT id, amount_cents, reason, kb_transaction_id, created_at FROM refunds WHERE order_id = $1 ORDER BY seq",
      [record.id],
    ),
  };
}

export async function loadOrderIn(client: PoolClient, orderKey: string): Promise<LoadedOrder | null> {
  const record = await row<OrderRow>(client, "SELECT * FROM orders WHERE order_key = $1 FOR UPDATE", [orderKey]);
  if (!record) return null;
  return {
    record,
    lines: await rows<OrderLineRow>(client, LINE_SQL, [record.id]),
    refunds: await rows<RefundRow>(
      client,
      "SELECT id, amount_cents, reason, kb_transaction_id, created_at FROM refunds WHERE order_id = $1 ORDER BY seq",
      [record.id],
    ),
  };
}

/** An `invoiced` order whose due date has passed reports `overdue`. */
export function effectiveStatus(record: OrderRow, today: IsoDate): OrderStatus {
  const dueDate = toIsoDate(record.due_date);
  if (record.status === "invoiced" && dueDate !== null && isOverdue(dueDate, today)) return "overdue";
  return record.status;
}

export function toOrderDto(loaded: LoadedOrder, today: IsoDate): Order {
  const { record } = loaded;
  const status = effectiveStatus(record, today);
  const lines: OrderLine[] = loaded.lines.map((line) => ({
    variant_code: line.variant_code,
    product_name: line.product_name,
    quantity: line.quantity,
    unit_price_cents: line.unit_price_cents,
    line_total_cents: line.unit_price_cents * line.quantity,
  }));
  const refunds: Refund[] = loaded.refunds.map((refund) => ({
    id: refund.id,
    amount_cents: refund.amount_cents,
    reason: refund.reason,
    kb_transaction_id: refund.kb_transaction_id,
    created_at: refund.created_at.toISOString(),
  }));

  const invoiceDate = toIsoDate(record.invoice_date);
  const dueDate = toIsoDate(record.due_date);

  return {
    order_key: record.order_key,
    status,
    display_status: DISPLAY_STATUS[status],
    payment_method: record.payment_method,
    price_tier: record.price_tier,
    lines,
    subtotal_cents: record.subtotal_cents,
    gst_cents: record.gst_cents,
    total_cents: record.total_cents,
    captured_cents: record.captured_cents,
    refunded_cents: record.refunded_cents,
    refunds,
    card_last4: record.card_last4,
    purchase_order: record.purchase_order,
    invoice:
      record.kb_invoice_id && record.invoice_number && invoiceDate && dueDate
        ? {
            kb_invoice_id: record.kb_invoice_id,
            invoice_number: record.invoice_number,
            invoice_date: invoiceDate,
            due_date: dueDate,
          }
        : null,
    created_at: record.created_at.toISOString(),
  };
}

/** Writes the order's three money figures from its lines. */
export async function recomputeTotals(client: PoolClient, orderId: string): Promise<void> {
  const lines = await rows<{ quantity: number; unit_price_cents: number }>(
    client,
    "SELECT quantity, unit_price_cents FROM order_lines WHERE order_id = $1",
    [orderId],
  );
  const totals = totalsFor(lines);
  await client.query(
    "UPDATE orders SET subtotal_cents = $2, gst_cents = $3, total_cents = $4 WHERE id = $1",
    [orderId, totals.subtotal_cents, totals.gst_cents, totals.total_cents],
  );
}

/**
 * Returns the caller's open order, creating one with a fresh key when needed. A
 * cart is repriced to the caller's tier on every read until it leaves the cart
 * state, then frozen.
 */
export async function openCartFor(client: PoolClient, userId: string, tier: PriceTier): Promise<LoadedOrder> {
  let record = await row<OrderRow>(
    client,
    `SELECT * FROM orders WHERE user_id = $1 AND status IN ('cart','declined','gateway_unavailable')
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [userId],
  );

  if (!record) {
    record = await row<OrderRow>(
      client,
      "INSERT INTO orders (order_key, user_id, status, price_tier) VALUES ($1,$2,'cart',$3) RETURNING *",
      [generateOrderKey(), userId, tier],
    );
    if (!record) throw new Error("failed to open a cart");
  }

  await repriceCart(client, record, tier);
  const reloaded = await loadOrderIn(client, record.order_key);
  if (!reloaded) throw new Error("the open cart disappeared while it was being read");
  return reloaded;
}

async function repriceCart(client: PoolClient, record: OrderRow, tier: PriceTier): Promise<void> {
  if (!isOpenCart(record.status)) return;

  const lines = await rows<{ variant_code: string; retail_price_cents: number; trade_price_cents: number }>(
    client,
    `SELECT ol.variant_code, v.retail_price_cents, v.trade_price_cents
     FROM order_lines ol JOIN variants v ON v.code = ol.variant_code
     WHERE ol.order_id = $1`,
    [record.id],
  );

  for (const line of lines) {
    await client.query("UPDATE order_lines SET unit_price_cents = $3 WHERE order_id = $1 AND variant_code = $2", [
      record.id,
      line.variant_code,
      unitPriceCentsFor(line, tier),
    ]);
  }
  await client.query("UPDATE orders SET price_tier = $2 WHERE id = $1", [record.id, tier]);
  await recomputeTotals(client, record.id);
  record.price_tier = tier;
}

/** Stock on hand always equals the sum of a variant's movements. */
export async function stockOnHand(client: PoolClient, variantCode: string): Promise<number> {
  const result = await row<{ on_hand: number }>(
    client,
    "SELECT COALESCE(SUM(delta), 0)::int AS on_hand FROM stock_movements WHERE variant_code = $1",
    [variantCode],
  );
  return result?.on_hand ?? 0;
}

/**
 * Reserves the clearance units an order needs, in the same transaction that checks
 * availability and before any Kill Bill call. Locking each variant row serialises
 * competing reservations, so exactly as many requests succeed as there are units.
 */
export async function reserveClearanceStock(
  client: PoolClient,
  order: LoadedOrder,
): Promise<void> {
  const clearanceLines = order.lines
    .filter((line) => line.clearance)
    .sort((a, b) => (a.variant_code < b.variant_code ? -1 : 1));

  for (const line of clearanceLines) {
    await client.query("SELECT 1 FROM variants WHERE code = $1 FOR UPDATE", [line.variant_code]);
    const onHand = await stockOnHand(client, line.variant_code);
    if (onHand < line.quantity) throw insufficientStock(onHand);
    await client.query(
      "INSERT INTO stock_movements (variant_code, delta, reason, order_key) VALUES ($1,$2,'sale',$3)",
      [line.variant_code, -line.quantity, order.record.order_key],
    );
  }
}

/** A decline or a Kill Bill outage releases the reservation under the same order key. */
export async function releaseClearanceStock(client: PoolClient, order: LoadedOrder): Promise<void> {
  for (const line of order.lines.filter((l) => l.clearance)) {
    await client.query(
      "INSERT INTO stock_movements (variant_code, delta, reason, order_key) VALUES ($1,$2,'release',$3)",
      [line.variant_code, line.quantity, order.record.order_key],
    );
  }
}

/** True when this order already holds a reservation that has not been released. */
export async function hasActiveReservation(client: PoolClient, order: LoadedOrder): Promise<boolean> {
  const result = await row<{ net: number }>(
    client,
    `SELECT COALESCE(SUM(delta), 0)::int AS net FROM stock_movements
     WHERE order_key = $1 AND reason IN ('sale','release')`,
    [order.record.order_key],
  );
  return (result?.net ?? 0) < 0;
}
