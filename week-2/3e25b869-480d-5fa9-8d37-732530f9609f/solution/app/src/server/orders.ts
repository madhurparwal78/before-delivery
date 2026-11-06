// Orders: the stored record, its published shape and the ship-on rule.
import type pg from 'pg';
import { type Locale } from '../shared/catalog.js';
import { money, type Money, type TaxLine } from '../shared/money.js';
import { addDays, torontoDate, wallClock, weekday } from '../shared/toronto.js';
import { type Db } from './db.js';

export interface Shipping {
  name: string;
  line1: string;
  city: string;
  province: string;
  postal_code: string;
}

interface OrderRow {
  number: string;
  customer_id: number;
  status: 'paid' | 'partially_refunded' | 'refunded';
  fulfilment: 'to_pack' | 'shipped';
  placed_at: Date;
  ship_on: string;
  locale: Locale;
  email: string;
  shipping: Shipping;
  subtotal_cents: number;
  shipping_cents: number;
  taxes: TaxLine[];
  total_cents: number;
  version: number;
  kb_invoice_id: string;
  kb_payment_id: string;
  kb_items: KbItems;
}

/** Kill Bill invoice item ids of an order: one per bar (`<batch>:<bar>`), the shipping item and one per tax. */
export interface KbItems {
  bars: Record<string, string>;
  shipping: string;
  taxes: Record<string, string>;
}

interface OrderLine {
  batch_code: string;
  bar: number;
  unit_cents: number;
  scent: string;
}

export interface RefundRow {
  number: string;
  order_number: string;
  status: 'issued' | 'failed';
  bars: { batch: string; bar: number }[];
  restock: boolean;
  amount_cents: number;
  allocation: { bars: number; shipping: number; taxes: TaxLine[] };
  reason: string;
  killbill_ref: string | null;
  created_at: Date;
}

export interface LoadedOrder {
  order: OrderRow;
  lines: OrderLine[];
  refunds: RefundRow[];
}

export async function loadOrder(db: Db | pg.Pool, number: string, lock = false): Promise<LoadedOrder | undefined> {
  const order = (await db.query<OrderRow>(`SELECT * FROM orders WHERE number = $1${lock ? ' FOR UPDATE' : ''}`, [number])).rows[0];
  if (!order) return undefined;
  const lines = (await db.query<OrderLine>(`SELECT l.batch_code, l.bar, l.unit_cents, b.scent FROM order_lines l JOIN batches b ON b.code = l.batch_code
     WHERE l.order_number = $1 ORDER BY l.batch_code, l.bar`,
    [number],
  )).rows;
  const refunds = (await db.query<RefundRow>('SELECT * FROM refunds WHERE order_number = $1 ORDER BY created_at, number', [number])).rows;
  return { order, lines, refunds };
}

export const barKey = (batch: string, bar: number) => `${batch}:${bar}`;

/** Bars covered by an issued refund. */
export const refundedBars = (refunds: RefundRow[]) =>
  new Set(refunds.filter((r) => r.status === 'issued').flatMap((r) => r.bars.map((b) => barKey(b.batch, b.bar))));

const refundedCents = (refunds: RefundRow[]) =>
  refunds.filter((r) => r.status === 'issued').reduce((sum, r) => sum + r.amount_cents, 0);

export function orderJson({ order, lines, refunds }: LoadedOrder) {
  const done = refundedBars(refunds);
  return {
    number: order.number,
    status: order.status,
    fulfilment: order.fulfilment,
    placed_at: order.placed_at.toISOString(),
    ship_on: order.ship_on,
    locale: order.locale,
    email: order.email,
    shipping: order.shipping,
    lines: lines.map((l) => ({
      batch: l.batch_code,
      scent: l.scent,
      bar: l.bar,
      unit_price: money(l.unit_cents),
      refunded: done.has(barKey(l.batch_code, l.bar)),
    })),
    subtotal: money(order.subtotal_cents),
    shipping_fee: money(order.shipping_cents),
    taxes: order.taxes,
    total: money(order.total_cents),
    refunded: money(refundedCents(refunds)) as Money,
    version: order.version,
  };
}

/** The ship date: the paid instant's Toronto date if it is a weekday before the cutoff, else the next weekday. */
export function shipOn(placedAt: Date, cutoff: string): string {
  const today = torontoDate(placedAt);
  const clock = wallClock(placedAt);
  const [hh, mm] = cutoff.split(':').map(Number) as [number, number];
  const weekdayToday = weekday(today) >= 1 && weekday(today) <= 5;
  if (weekdayToday && clock.hour * 60 + clock.minute < hh * 60 + mm) return today;
  let day = addDays(today, 1);
  while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, 1);
  return day;
}
