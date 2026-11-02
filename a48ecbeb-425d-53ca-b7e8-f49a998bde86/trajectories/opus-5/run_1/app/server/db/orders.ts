import crypto from 'node:crypto';
import type { FlavourSlug, ProvinceCode } from '../../shared/catalogue.js';
import type { OrderStatus, RefundStatus } from '../../shared/orderStatus.js';
import type { Quote, QuoteLine, QuoteTax } from '../../shared/quote.js';
import {
  addSplits,
  emptySplit,
  subtractSplits,
  type RefundSplit,
} from '../../shared/refundSplit.js';
import { isoTimestamp } from '../../shared/time.js';
import { query, transaction, type Runner, type Transaction } from './pool.js';

const poolRunner: Runner = { query };

export interface ShipTo {
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: ProvinceCode;
  postal_code: string;
}

export type RefundRecordStatus = 'pending_provider' | 'applied' | 'rejected';

export interface RefundRecord {
  id: string;
  status: RefundRecordStatus;
  amount_cents: number;
  reason: string;
  split: RefundSplit;
  created_at: string;
  transaction_key: string;
}

export interface OrderRecord {
  number: string;
  user_id: string;
  kind: 'checkout' | 'renewal';
  status: OrderStatus;
  refund_status: RefundStatus;
  placed_at: string;
  province: ProvinceCode;
  subscription_id: string | null;
  killbill_account_id: string;
  killbill_invoice_id: string | null;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: QuoteTax[];
  total_cents: number;
  refunded_cents: number;
  refundable_cents: number;
  ship_to: ShipTo;
  refunds: RefundRecord[];
  customer_email: string;
  customer_name: string;
}

interface OrderRow {
  number: string;
  user_id: string;
  kind: 'checkout' | 'renewal';
  status: OrderStatus;
  refund_status: RefundStatus;
  placed_at: Date;
  province: string;
  subscription_id: string | null;
  killbill_account_id: string;
  killbill_invoice_id: string | null;
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  total_cents: number;
  taxes: QuoteTax[];
  ship_to: ShipTo;
  customer_email: string;
  customer_name: string;
}

interface LineRow {
  order_number: string;
  position: number;
  flavour: string;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
}

interface RefundRow {
  id: string;
  order_number: string;
  status: RefundRecordStatus;
  amount_cents: number;
  reason: string;
  split: RefundSplit;
  transaction_key: string;
  created_at: Date;
}

export async function nextOrderNumber(tx: Transaction): Promise<string> {
  const rows = await tx.query<{ value: string }>("select nextval('order_number_seq')::text as value");
  return `CB-${rows[0]!.value}`;
}

export interface NewOrder {
  /** A number reserved ahead of the insert, for a renewal whose payment key needs it. */
  number?: string;
  userId: string;
  kind: 'checkout' | 'renewal';
  quote: Quote;
  shipTo: ShipTo;
  subscriptionId: string | null;
  killbillAccountId: string;
  killbillInvoiceId: string | null;
  customerEmail: string;
  customerName: string;
}

export async function insertOrder(tx: Transaction, input: NewOrder): Promise<string> {
  const number = input.number ?? (await nextOrderNumber(tx));
  const { quote } = input;
  await tx.execute(
    `insert into orders (
       number, user_id, kind, status, province, subscription_id, killbill_account_id,
       killbill_invoice_id, goods_cents, discount_cents, discounted_goods_cents,
       shipping_cents, deposit_cents, total_cents, taxes, ship_to, customer_email, customer_name
     ) values ($1,$2,$3,'pending_payment',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      number,
      input.userId,
      input.kind,
      quote.province,
      input.subscriptionId,
      input.killbillAccountId,
      input.killbillInvoiceId,
      quote.goods_cents,
      quote.discount_cents,
      quote.discounted_goods_cents,
      quote.shipping_cents,
      quote.deposit_cents,
      quote.total_cents,
      JSON.stringify(quote.taxes),
      JSON.stringify(input.shipTo),
      input.customerEmail,
      input.customerName,
    ],
  );
  for (const [position, line] of quote.lines.entries()) {
    await tx.execute(
      `insert into order_lines (
         order_number, position, flavour, quantity, unit_price_cents,
         goods_cents, discount_cents, deposit_cents
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        number,
        position,
        line.flavour,
        line.quantity,
        line.unit_price_cents,
        line.goods_cents,
        line.discount_cents,
        line.deposit_cents,
      ],
    );
  }
  return number;
}


export async function setOrderStatus(orderNumber: string, status: OrderStatus): Promise<void> {
  await query('update orders set status = $2 where number = $1', [orderNumber, status]);
}


function toRecord(
  row: OrderRow,
  lines: readonly LineRow[],
  refunds: readonly RefundRow[],
): OrderRecord {
  const refundRecords: RefundRecord[] = refunds.map((refund) => ({
    id: refund.id,
    status: refund.status,
    amount_cents: refund.amount_cents,
    reason: refund.reason,
    split: refund.split,
    created_at: isoTimestamp(refund.created_at),
    transaction_key: refund.transaction_key,
  }));
  const appliedCents = refundRecords
    .filter((refund) => refund.status === 'applied')
    .reduce((sum, refund) => sum + refund.amount_cents, 0);
  const committedCents = refundRecords
    .filter((refund) => refund.status === 'applied' || refund.status === 'pending_provider')
    .reduce((sum, refund) => sum + refund.amount_cents, 0);

  return {
    number: row.number,
    user_id: row.user_id,
    kind: row.kind,
    status: row.status,
    refund_status: row.refund_status,
    placed_at: isoTimestamp(row.placed_at),
    province: row.province as ProvinceCode,
    subscription_id: row.subscription_id,
    killbill_account_id: row.killbill_account_id,
    killbill_invoice_id: row.killbill_invoice_id,
    lines: lines.map((line) => ({
      flavour: line.flavour as FlavourSlug,
      quantity: line.quantity,
      unit_price_cents: line.unit_price_cents,
      goods_cents: line.goods_cents,
      discount_cents: line.discount_cents,
      deposit_cents: line.deposit_cents,
    })),
    goods_cents: row.goods_cents,
    discount_cents: row.discount_cents,
    discounted_goods_cents: row.discounted_goods_cents,
    shipping_cents: row.shipping_cents,
    deposit_cents: row.deposit_cents,
    taxes: row.taxes,
    total_cents: row.total_cents,
    refunded_cents: appliedCents,
    refundable_cents: row.total_cents - committedCents,
    ship_to: row.ship_to,
    refunds: refundRecords,
    customer_email: row.customer_email,
    customer_name: row.customer_name,
  };
}

async function hydrate(runner: Runner, rows: readonly OrderRow[]): Promise<OrderRecord[]> {
  if (rows.length === 0) return [];
  const numbers = rows.map((row) => row.number);
  const lines = await runner.query<LineRow>(
    'select * from order_lines where order_number = any($1::text[]) order by position',
    [numbers],
  );
  const refunds = await runner.query<RefundRow>(
    'select * from refunds where order_number = any($1::text[]) order by created_at',
    [numbers],
  );
  return rows.map((row) =>
    toRecord(
      row,
      lines.filter((line) => line.order_number === row.number),
      refunds.filter((refund) => refund.order_number === row.number),
    ),
  );
}

/** Reads one order, optionally inside the transaction that is building it. */
export async function findOrder(
  orderNumber: string,
  runner: Runner = poolRunner,
): Promise<OrderRecord | null> {
  const rows = await runner.query<OrderRow>('select * from orders where number = $1', [
    orderNumber,
  ]);
  if (rows.length === 0) return null;
  return (await hydrate(runner, rows))[0]!;
}

export async function listCustomerOrders(userId: string): Promise<OrderRecord[]> {
  const rows = await query<OrderRow>(
    "select * from orders where user_id = $1 and status <> 'pending_payment' order by placed_at desc, number desc",
    [userId],
  );
  return hydrate(poolRunner, rows);
}

export async function listQueueOrders(): Promise<OrderRecord[]> {
  const rows = await query<OrderRow>(
    "select * from orders where status in ('paid','picking','packed') order by placed_at asc, number asc",
  );
  return hydrate(poolRunner, rows);
}

export async function searchOrders(term: string): Promise<OrderRecord[]> {
  const rows = await query<OrderRow>(
    `select * from orders
      where status <> 'pending_payment'
        and (upper(number) = upper($1) or lower(customer_email) = lower($1))
      order by placed_at desc`,
    [term],
  );
  return hydrate(poolRunner, rows);
}

export async function countPaidOrdersWithFlavour(
  userId: string,
  flavour: FlavourSlug,
): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count
       from orders o join order_lines l on l.order_number = o.number
      where o.user_id = $1 and l.flavour = $2 and o.status <> 'pending_payment'`,
    [userId, flavour],
  );
  return Number(rows[0]?.count ?? '0');
}

/* ------------------------------------------------------------------- refunds */

/** The parts of an order still open to refund, after applied and pending refunds. */
export function remainingRefundable(order: OrderRecord): RefundSplit {
  const whole: RefundSplit = {
    lines: order.lines.map((line) => ({
      flavour: line.flavour,
      goods_cents: line.goods_cents - line.discount_cents,
      deposit_cents: line.deposit_cents,
    })),
    shipping_cents: order.shipping_cents,
    taxes: order.taxes.map((tax) => ({ name: tax.name, cents: tax.cents })),
  };
  const committed = order.refunds
    .filter((refund) => refund.status === 'applied' || refund.status === 'pending_provider')
    .reduce((sum, refund) => addSplits(sum, refund.split), emptySplit(whole));
  return subtractSplits(whole, committed);
}

export interface InsertRefundInput {
  orderNumber: string;
  amountCents: number;
  reason: string;
  split: RefundSplit;
  transactionKey: string;
}

/**
 * Records a refund against the order's remaining refundable amount, under a row
 * lock, so simultaneous refunds that together overflow are refused.
 */
export async function insertRefundIfItFits(
  input: InsertRefundInput,
): Promise<{ refund: RefundRecord; order: OrderRecord } | 'over_limit'> {
  return transaction(async (tx) => {
    await tx.query('select number from orders where number = $1 for update', [input.orderNumber]);
    const order = (await findOrder(input.orderNumber, tx))!;
    if (input.amountCents > order.refundable_cents) return 'over_limit';

    const id = crypto.randomUUID();
    await tx.execute(
      `insert into refunds (id, order_number, status, amount_cents, reason, split, transaction_key)
       values ($1,$2,'pending_provider',$3,$4,$5,$6)`,
      [
        id,
        input.orderNumber,
        input.amountCents,
        input.reason,
        JSON.stringify(input.split),
        input.transactionKey,
      ],
    );
    const refreshed = (await findOrder(input.orderNumber, tx))!;
    return { refund: refreshed.refunds.find((refund) => refund.id === id)!, order: refreshed };
  });
}

export async function setRefundStatus(
  refundId: string,
  status: RefundRecordStatus,
): Promise<void> {
  await query('update refunds set status = $2, claimed_at = null where id = $1', [
    refundId,
    status,
  ]);
}

export async function setRefundStatusOnOrder(
  orderNumber: string,
  refundStatus: RefundStatus,
): Promise<void> {
  await query('update orders set refund_status = $2 where number = $1', [
    orderNumber,
    refundStatus,
  ]);
}



/** Claims refunds waiting on Kill Bill, so one process confirms each exactly once. */
export async function claimPendingRefunds(): Promise<
  Array<{ refundId: string; orderNumber: string }>
> {
  const rows = await query<{ id: string; order_number: string }>(
    `update refunds set claimed_at = now()
      where id in (
        select id from refunds
         where status = 'pending_provider'
           and (claimed_at is null or claimed_at < now() - interval '20 seconds')
         order by created_at
         limit 20
         for update skip locked
      )
      returning id, order_number`,
  );
  return rows.map((row) => ({ refundId: row.id, orderNumber: row.order_number }));
}

export async function releaseRefundClaim(refundId: string): Promise<void> {
  await query('update refunds set claimed_at = null where id = $1', [refundId]);
}

export async function dashboardRefunds(): Promise<{ count: number; total_cents: number }> {
  const rows = await query<{ count: string; total: string }>(
    `select count(*)::text as count, coalesce(sum(amount_cents), 0)::text as total
       from refunds
      where status = 'applied' and created_at >= now() - interval '30 days'`,
  );
  return { count: Number(rows[0]?.count ?? '0'), total_cents: Number(rows[0]?.total ?? '0') };
}
