// API JSON views, built in the published key order.
import { money, type Money, type TaxLine } from "../core/money.js";
import { taxLinesFromJson, taxLinesToJson, type BarView, type BatchRow, type StockCount } from "./stock.js";
import { addDays, torontoLocalMinute, torontoMidnight, dateToString } from "../core/toronto.js";
import { findProvince } from "../core/provinces.js";

export function moneyView(cents: number): Money {
  return money(cents);
}

export function taxLineView(tax: TaxLine): { code: string; rate: string; amount: Money } {
  return { code: tax.code, rate: tax.rateLabel, amount: tax.amount };
}

export interface BatchView {
  code: string;
  scent: string;
  state: string;
  bars_cut: number;
  available: number;
  held: number;
  sold: number;
  bars: { number: number; status: string }[];
  unit_price: Money;
  cure_date: string;
  drop_at: string | null;
  drop_at_local: string | null;
}

export function batchView(batch: BatchRow, stock: { counts: StockCount; bars: BarView[] }): BatchView {
  return {
    code: batch.code,
    scent: batch.scent,
    state: batch.state,
    bars_cut: stock.counts.cut,
    available: stock.counts.available,
    held: stock.counts.held,
    sold: stock.counts.sold,
    bars: stock.bars.map((bar) => ({ number: bar.number, status: bar.status })),
    unit_price: money(1_100),
    cure_date: addDays(dateString(batch.poured_on), batch.cure_days),
    drop_at: batch.drop_at ? batch.drop_at.toISOString() : null,
    drop_at_local: batch.drop_at ? torontoLocalMinute(batch.drop_at) : null
  };
}

function dateString(value: string | Date): string {
  return dateToString(value);
}

export interface HoldView {
  id: string;
  batch: string;
  bar: number;
  status: string;
  created_at: string;
  expires_at: string;
  amount: Money;
}

export interface OrderView {
  number: string;
  status: string;
  fulfilment: string;
  placed_at: string;
  ship_on: string;
  locale: string;
  email: string;
  shipping: { name: string; line1: string; city: string; province: string; postal_code: string };
  lines: { batch: string; scent: string; bar: number; unit_price: Money; refunded: boolean }[];
  subtotal: Money;
  shipping_fee: Money;
  taxes: { code: string; rate: string; amount: Money }[];
  total: Money;
  refunded: Money;
  version: number;
}

export interface OrderRecord {
  number: string;
  status: string;
  fulfilment: string;
  placed_at: Date;
  ship_on: string;
  locale: string;
  email: string;
  name: string;
  line1: string;
  city: string;
  province: string;
  postal_code: string;
  subtotal_cents: number;
  shipping_cents: number;
  taxes: unknown;
  total_cents: number;
  refunded_cents: number;
  version: number;
  lines: { batch_code: string; scent: string; bar: number; unit_cents: number; refunded: boolean; kb_invoice_item_id: string | null }[];
}

export function orderView(record: OrderRecord): OrderView {
  return {
    number: record.number,
    status: record.status,
    fulfilment: record.fulfilment,
    placed_at: record.placed_at.toISOString(),
    ship_on: record.ship_on,
    locale: record.locale,
    email: record.email,
    shipping: {
      name: record.name,
      line1: record.line1,
      city: record.city,
      province: record.province,
      postal_code: record.postal_code
    },
    lines: record.lines.map((line) => ({
      batch: line.batch_code,
      scent: line.scent,
      bar: line.bar,
      unit_price: money(line.unit_cents),
      refunded: line.refunded
    })),
    subtotal: money(record.subtotal_cents),
    shipping_fee: money(record.shipping_cents),
    taxes: taxLinesFromJson(record.taxes).map(taxLineView),
    total: money(record.total_cents),
    refunded: money(record.refunded_cents),
    version: record.version
  };
}

export interface SubscriptionView {
  number: string;
  state: string;
  scent: string;
  cadence: string;
  pending_cadence: string | null;
  started_on: string;
  next_bill_date: string | null;
  skipped_bill_date: string | null;
  paused_from: string | null;
  locks_at: string | null;
  locked: boolean;
  shipping: { name: string; line1: string; city: string; province: string; postal_code: string };
  price: {
    subtotal: Money;
    discount: Money;
    pre_tax: Money;
    taxes: { code: string; rate: string; amount: Money }[];
    total: Money;
  };
  version: number;
}

export interface SubscriptionRecord {
  number: string;
  killbill_subscription_id: string;
  state: string;
  scent: string;
  cadence: string;
  pending_cadence: string | null;
  anchor_date: string;
  started_on: string;
  next_bill_date: string | null;
  skipped_bill_date: string | null;
  paused_from: string | null;
  name: string;
  line1: string;
  city: string;
  province: string;
  postal_code: string;
  version: number;
}

export function subscriptionPriceView(subscription: SubscriptionRecord): SubscriptionView["price"] {
  const taxes = subscriptionTaxes(subscription.province);
  const subtotal = money(3_300);
  const discount = money(Math.floor((subtotal.cents * 12_000 + 50_000) / 100_000));
  const preTax = money(subtotal.cents - discount.cents);
  const taxLines = taxes.map((tax) => ({
    code: tax.code,
    rate: tax.rateLabel,
    amount: money(Math.floor((preTax.cents * tax.rateHundredThousandths + 50_000) / 100_000))
  }));
  return {
    subtotal,
    discount,
    pre_tax: preTax,
    taxes: taxLines.map((line) => ({ code: line.code, rate: line.rate, amount: line.amount })),
    total: money(preTax.cents + taxLines.reduce((sum, line) => sum + line.amount.cents, 0))
  };
}

function subscriptionTaxes(province: string) {
  return findProvince(province)?.taxes ?? [];
}

export function subscriptionView(record: SubscriptionRecord, lockHours: number): SubscriptionView {
  const locksAt = computeLocksAt(record, lockHours);
  return {
    number: record.number,
    state: record.state,
    scent: record.scent,
    cadence: record.cadence,
    pending_cadence: record.pending_cadence,
    started_on: record.started_on,
    next_bill_date: record.next_bill_date,
    skipped_bill_date: record.skipped_bill_date,
    paused_from: record.paused_from,
    locks_at: locksAt ? locksAt.toISOString() : null,
    locked: locksAt ? new Date() >= locksAt : false,
    shipping: {
      name: record.name,
      line1: record.line1,
      city: record.city,
      province: record.province,
      postal_code: record.postal_code
    },
    price: subscriptionPriceView(record),
    version: record.version
  };
}

function computeLocksAt(record: SubscriptionRecord, lockHours: number): Date | null {
  const date = record.state === "active" ? record.next_bill_date : record.skipped_bill_date ?? record.next_bill_date;
  if (!date) return null;
  const midnight = torontoMidnight(date);
  return new Date(midnight.getTime() - lockHours * 3_600_000);
}

export interface RefundView {
  number: string;
  order: string;
  status: string;
  bars: { batch: string; bar: number }[];
  restock: boolean;
  amount: Money;
  allocation: { bars: Money; shipping: Money; taxes: { code: string; rate: string; amount: Money }[] };
  reason: string;
  killbill_ref: string | null;
  created_at: string;
}

export interface RefundRecord {
  number: string;
  order_number: string;
  status: string;
  bars: { batch: string; bar: number }[];
  restock: boolean;
  amount_cents: number;
  allocation: { bars_cents: number; shipping_cents: number; taxes: { code: string; rate: string; amount_cents: number }[] };
  reason: string;
  killbill_ref: string | null;
  created_at: Date;
}

export function refundView(record: RefundRecord): RefundView {
  return {
    number: record.number,
    order: record.order_number,
    status: record.status,
    bars: record.bars,
    restock: record.restock,
    amount: money(record.amount_cents),
    allocation: {
      bars: money(record.allocation.bars_cents),
      shipping: money(record.allocation.shipping_cents),
      taxes: record.allocation.taxes.map((tax) => ({
        code: tax.code,
        rate: tax.rate,
        amount: money(tax.amount_cents)
      }))
    },
    reason: record.reason,
    killbill_ref: record.killbill_ref,
    created_at: record.created_at.toISOString()
  };
}

export interface CreditView {
  number: string;
  target: string;
  status: string;
  amount: Money;
  reason: string;
  killbill_ref: string | null;
  created_at: string;
}

export interface CreditRecord {
  number: string;
  target: string;
  status: string;
  amount_cents: number;
  reason: string;
  killbill_ref: string | null;
  created_at: Date;
}

export function creditView(record: CreditRecord): CreditView {
  return {
    number: record.number,
    target: record.target,
    status: record.status,
    amount: money(record.amount_cents),
    reason: record.reason,
    killbill_ref: record.killbill_ref,
    created_at: record.created_at.toISOString()
  };
}

export interface AuditView {
  id: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  reason: string;
  amount: Money;
  killbill_ref: string | null;
  outcome: string;
}

export function auditView(row: {
  id: number;
  at: Date;
  actor: string;
  role: string;
  action: string;
  target: string;
  reason: string;
  amount: unknown;
  killbill_ref: string | null;
  outcome: string;
}): AuditView {
  const amount = row.amount as { cents: number; currency: string };
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    role: row.role,
    action: row.action,
    target: row.target,
    reason: row.reason,
    amount: money(amount.cents),
    killbill_ref: row.killbill_ref,
    outcome: row.outcome
  };
}

export interface PackingOrderView {
  number: string;
  ship_on: string;
  name: string;
  address: { line1: string; city: string; province: string; postal_code: string };
  bars: { batch: string; scent: string; bar: number }[];
  fulfilment: string;
  version: number;
}

export interface ReconciliationLineView {
  key: string;
  kind: string;
  shop: Money | null;
  killbill: Money | null;
  status: string;
}

export { taxLinesToJson, taxLinesFromJson };
