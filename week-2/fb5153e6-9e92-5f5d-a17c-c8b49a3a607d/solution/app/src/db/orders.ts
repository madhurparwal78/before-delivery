import { query, queryOne } from './pool.js';
import type { LicenceType, OrderStatus } from '../domain/money.js';
import { orderStatus, refundableCents } from '../domain/money.js';
import type { Locale } from '../shared/locale.js';

export interface OrderRecord {
  readonly id: number;
  readonly orderRef: string;
  readonly receiptToken: string;
  readonly modelId: number;
  readonly modelSlug: string;
  readonly modelTitle: string;
  readonly email: string;
  readonly licence: LicenceType;
  readonly seats: number;
  readonly amountCents: number;
  readonly refundedCents: number;
  readonly refundedSeats: number;
  readonly editionNumber: number | null;
  readonly editionTotal: number | null;
  readonly locale: Locale;
  readonly upgradedTo: LicenceType | null;
  readonly upgradeFromOrderId: number | null;
  readonly killbillPaymentId: string | null;
  readonly createdAt: Date;
  readonly status: OrderStatus;
  readonly refundableCents: number;
}

interface OrderDbRow {
  id: number;
  order_ref: string;
  receipt_token: string;
  model_id: number;
  slug: string;
  title: string;
  edition_total: number | null;
  email: string;
  licence: LicenceType;
  seats: number;
  amount_cents: number;
  refunded_cents: number;
  refunded_seats: number;
  edition_number: number | null;
  locale: Locale;
  upgraded_to: LicenceType | null;
  upgrade_from_order_id: number | null;
  killbill_payment_id: string | null;
  created_at: Date;
}

const SELECT = `
  SELECT o.*, m.slug, m.title, m.edition_total
  FROM orders o JOIN models m ON m.id = o.model_id`;

function toRecord(row: OrderDbRow): OrderRecord {
  return {
    id: row.id,
    orderRef: row.order_ref,
    receiptToken: row.receipt_token,
    modelId: row.model_id,
    modelSlug: row.slug,
    modelTitle: row.title,
    email: row.email,
    licence: row.licence,
    seats: row.seats,
    amountCents: row.amount_cents,
    refundedCents: row.refunded_cents,
    refundedSeats: row.refunded_seats,
    editionNumber: row.edition_number,
    editionTotal: row.edition_total,
    locale: row.locale,
    upgradedTo: row.upgraded_to,
    upgradeFromOrderId: row.upgrade_from_order_id,
    killbillPaymentId: row.killbill_payment_id,
    createdAt: row.created_at,
    status: orderStatus(row.amount_cents, row.refunded_cents),
    refundableCents: refundableCents(row.amount_cents, row.refunded_cents),
  };
}

export async function findOrderByReceiptToken(token: string): Promise<OrderRecord | null> {
  const row = await queryOne<OrderDbRow>(`${SELECT} WHERE o.receipt_token = $1`, [token]);
  return row === null ? null : toRecord(row);
}

export async function findOrderByRef(orderRef: string): Promise<OrderRecord | null> {
  const row = await queryOne<OrderDbRow>(`${SELECT} WHERE o.order_ref = $1`, [orderRef]);
  return row === null ? null : toRecord(row);
}

export async function findOrdersByEmail(email: string): Promise<readonly OrderRecord[]> {
  const rows = await query<OrderDbRow>(
    `${SELECT} WHERE lower(o.email) = lower($1) ORDER BY o.created_at DESC, o.id DESC`,
    [email],
  );
  return rows.map(toRecord);
}

export interface NewOrder {
  readonly orderRef: string;
  readonly receiptToken: string;
  readonly modelId: number;
  readonly email: string;
  readonly licence: LicenceType;
  readonly seats: number;
  readonly amountCents: number;
  readonly editionNumber: number | null;
  readonly locale: Locale;
  readonly upgradeFromOrderId: number | null;
  readonly killbillAccountId: string;
  readonly killbillInvoiceId: string;
  readonly killbillPaymentId: string;
}

export async function insertOrder(order: NewOrder): Promise<OrderRecord> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO orders (order_ref, receipt_token, model_id, email, licence, seats, amount_cents,
       edition_number, locale, upgrade_from_order_id, killbill_account_id, killbill_invoice_id,
       killbill_payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      order.orderRef,
      order.receiptToken,
      order.modelId,
      order.email,
      order.licence,
      order.seats,
      order.amountCents,
      order.editionNumber,
      order.locale,
      order.upgradeFromOrderId,
      order.killbillAccountId,
      order.killbillInvoiceId,
      order.killbillPaymentId,
    ],
  );
  if (row === null) throw new Error('Order row was not created');
  const stored = await queryOne<OrderDbRow>(`${SELECT} WHERE o.id = $1`, [row.id]);
  if (stored === null) throw new Error('Order row was not found after insert');
  return toRecord(stored);
}

export async function markUpgraded(orderId: number, to: LicenceType): Promise<void> {
  await query(`UPDATE orders SET upgraded_to = $2 WHERE id = $1`, [orderId, to]);
}

/**
 * The net amount paid, after refunds, across this order and every earlier order
 * in its upgrade chain.
 */
export async function netPaidInChain(orderId: number): Promise<number> {
  let total = 0;
  let current: number | null = orderId;
  const seen = new Set<number>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const row: { amount_cents: number; refunded_cents: number; upgrade_from_order_id: number | null } | null =
      await queryOne(
        `SELECT amount_cents, refunded_cents, upgrade_from_order_id FROM orders WHERE id = $1`,
        [current],
      );
    if (row === null) break;
    total += row.amount_cents - row.refunded_cents;
    current = row.upgrade_from_order_id;
  }
  return total;
}

export async function recordRefund(
  orderId: number,
  kind: 'full' | 'seats',
  seats: number | null,
  amountCents: number,
): Promise<void> {
  await query(
    `INSERT INTO refunds (order_id, kind, seats, amount_cents) VALUES ($1, $2, $3, $4)`,
    [orderId, kind, seats, amountCents],
  );
  await query(
    `UPDATE orders SET refunded_cents = refunded_cents + $2,
       refunded_seats = refunded_seats + COALESCE($3, seats - refunded_seats)
     WHERE id = $1`,
    [orderId, amountCents, seats],
  );
}

export interface RefundRecord {
  readonly amountCents: number;
  readonly createdAt: Date;
}

export async function refundsForOrder(orderId: number): Promise<readonly RefundRecord[]> {
  const rows = await query<{ amount_cents: number; created_at: Date }>(
    `SELECT amount_cents, created_at FROM refunds WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows.map((r) => ({ amountCents: r.amount_cents, createdAt: r.created_at }));
}
