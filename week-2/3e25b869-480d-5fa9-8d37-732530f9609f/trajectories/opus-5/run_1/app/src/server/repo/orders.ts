import { money } from '../../shared/money.js';
import type {
  Credit,
  Fulfilment,
  Locale,
  Order,
  OrderLine,
  OrderStatus,
  Refund,
  RefundAllocation,
  ShippingAddress,
  TaxLine,
} from '../../shared/types.js';
import type { Queryable } from '../db/pool.js';
import { orderedBarRef, orderedShipping, orderedTaxLines } from './normalize.js';

export type OrderRow = {
  number: string;
  customer_id: string;
  email: string;
  locale: Locale;
  status: OrderStatus;
  fulfilment: Fulfilment;
  placed_at: Date;
  ship_on: string;
  shipping: ShippingAddress;
  subtotal_cents: number;
  shipping_cents: number;
  taxes: TaxLine[];
  total_cents: number;
  version: number;
  killbill_invoice_id: string;
  killbill_payment_id: string;
  killbill_items: Record<string, string>;
};

export type OrderLineRow = {
  batch_code: string;
  scent: string;
  bar: number;
  unit_price_cents: number;
  refunded: boolean;
};

export type OrderRecord = { row: OrderRow; lines: OrderLineRow[]; refundedCents: number };

const ORDER_COLUMNS = `number, customer_id, email, locale, status, fulfilment, placed_at, ship_on,
  shipping, subtotal_cents, shipping_cents, taxes, total_cents, version,
  killbill_invoice_id, killbill_payment_id, killbill_items`;

export async function loadOrder(
  client: Queryable,
  number: string,
  options: { forUpdate?: boolean } = {},
): Promise<OrderRecord | null> {
  const orders = await client.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE number = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [number],
  );
  const row = orders.rows[0];
  if (!row) return null;
  const lines = await client.query<OrderLineRow>(
    `SELECT batch_code, scent, bar, unit_price_cents, refunded FROM order_lines
      WHERE order_number = $1 ORDER BY batch_code, bar`,
    [number],
  );
  const refunded = await client.query<{ total: string | null }>(
    `SELECT sum(amount_cents)::text AS total FROM refunds WHERE order_number = $1 AND status = 'issued'`,
    [number],
  );
  return {
    row,
    lines: lines.rows,
    refundedCents: Number(refunded.rows[0]?.total ?? 0),
  };
}

export function orderLines(record: OrderRecord): OrderLine[] {
  return record.lines.map((line) => ({
    batch: line.batch_code,
    scent: line.scent,
    bar: line.bar,
    unit_price: money(line.unit_price_cents),
    refunded: line.refunded,
  }));
}

export function serializeOrder(record: OrderRecord): Order {
  const row = record.row;
  return {
    number: row.number,
    status: row.status,
    fulfilment: row.fulfilment,
    placed_at: row.placed_at.toISOString(),
    ship_on: row.ship_on,
    locale: row.locale,
    email: row.email,
    shipping: orderedShipping(row.shipping),
    lines: orderLines(record),
    subtotal: money(row.subtotal_cents),
    shipping_fee: money(row.shipping_cents),
    taxes: orderedTaxLines(row.taxes),
    total: money(row.total_cents),
    refunded: money(record.refundedCents),
    version: row.version,
  };
}

export type RefundRow = {
  number: string;
  order_number: string;
  status: 'requested' | 'issued' | 'failed';
  restock: boolean;
  bars: { batch: string; bar: number }[];
  amount_cents: number;
  alloc_bars_cents: number;
  alloc_shipping_cents: number;
  alloc_taxes: TaxLine[];
  reason: string;
  killbill_ref: string | null;
  created_at: Date;
};

export function serializeRefund(row: RefundRow): Refund {
  return {
    number: row.number,
    order: row.order_number,
    status: row.status,
    bars: row.bars.map(orderedBarRef),
    restock: row.restock,
    amount: money(row.amount_cents),
    allocation: {
      bars: money(row.alloc_bars_cents),
      shipping: money(row.alloc_shipping_cents),
      taxes: orderedTaxLines(row.alloc_taxes),
    },
    reason: row.reason,
    killbill_ref: row.killbill_ref,
    created_at: row.created_at.toISOString(),
  };
}

const REFUND_COLUMNS = `number, order_number, status, restock, bars, amount_cents,
  alloc_bars_cents, alloc_shipping_cents, alloc_taxes, reason, killbill_ref, created_at`;

export async function loadRefunds(client: Queryable, orderNumber: string): Promise<RefundRow[]> {
  const result = await client.query<RefundRow>(
    `SELECT ${REFUND_COLUMNS} FROM refunds WHERE order_number = $1 ORDER BY number`,
    [orderNumber],
  );
  return result.rows;
}

export function issuedAllocations(rows: readonly RefundRow[]): RefundAllocation[] {
  return rows
    .filter((row) => row.status === 'issued')
    .map((row) => ({
      bars: money(row.alloc_bars_cents),
      shipping: money(row.alloc_shipping_cents),
      taxes: orderedTaxLines(row.alloc_taxes),
    }));
}

export type CreditRow = {
  number: string;
  target: string;
  customer_id: string;
  status: 'issued' | 'failed';
  amount_cents: number;
  reason: string;
  killbill_ref: string | null;
  created_at: Date;
};

export function serializeCredit(row: CreditRow): Credit {
  return {
    number: row.number,
    target: row.target,
    status: row.status,
    amount: money(row.amount_cents),
    reason: row.reason,
    killbill_ref: row.killbill_ref,
    created_at: row.created_at.toISOString(),
  };
}

export async function loadCreditsFor(client: Queryable, target: string): Promise<CreditRow[]> {
  const result = await client.query<CreditRow>(
    `SELECT number, target, customer_id, status, amount_cents, reason, killbill_ref, created_at
       FROM credits WHERE target = $1 ORDER BY number`,
    [target],
  );
  return result.rows;
}
