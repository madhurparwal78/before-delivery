import type { Db } from './db.js';
import type { Currency } from './money.js';
import type { OrderState, PlanId } from './domain.js';

export interface OrderRow {
  id: string;
  number: string;
  accountId: string | null;
  sessionId: string | null;
  plan: PlanId;
  planName: string;
  currency: Currency;
  state: OrderState;
  total_minor: string;
  due_now_minor: string;
  due_at_launch_minor: string;
  acceptedAt: Date | null;
  priceRowId: string | null;
  projectId: string | null;
  killbillBundleId: string | null;
  killbillSubscriptionId: string | null;
  createdAt: Date;
}

function mapOrderRow(row: Record<string, unknown>): OrderRow {
  return {
    id: row.id as string,
    number: row.number as string,
    accountId: row.account_id as string | null,
    sessionId: row.session_id as string | null,
    plan: row.plan as PlanId,
    planName: row.plan_name as string,
    currency: row.currency as Currency,
    state: row.state as OrderState,
    total_minor: String(row.total_minor),
    due_now_minor: String(row.due_now_minor),
    due_at_launch_minor: String(row.due_at_launch_minor),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at as Date) : null,
    priceRowId: row.price_row_id as string | null,
    projectId: row.project_id as string | null,
    killbillBundleId: row.killbill_bundle_id as string | null,
    killbillSubscriptionId: row.killbill_subscription_id as string | null,
    createdAt: new Date(row.created_at as Date),
  };
}

export async function getOrder(db: Db, orderId: string): Promise<OrderRow | null> {
  const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (result.rowCount === 0) return null;
  return mapOrderRow(result.rows[0]!);
}

export async function lockOrder(db: Db, orderId: string): Promise<OrderRow | null> {
  const result = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (result.rowCount === 0) return null;
  return mapOrderRow(result.rows[0]!);
}

export async function tryLockOrder(db: Db, orderId: string): Promise<OrderRow | 'busy' | null> {
  try {
    const result = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE NOWAIT', [orderId]);
    if (result.rowCount === 0) return null;
    return mapOrderRow(result.rows[0]!);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '55P03' || code === '55P02') return 'busy';
    throw err;
  }
}

export async function listOrdersByAccount(db: Db, accountId: string): Promise<OrderRow[]> {
  const result = await db.query('SELECT * FROM orders WHERE account_id = $1 ORDER BY created_at ASC', [accountId]);
  return result.rows.map(mapOrderRow);
}

export async function listAllOrders(db: Db): Promise<OrderRow[]> {
  const result = await db.query('SELECT * FROM orders ORDER BY number ASC');
  return result.rows.map(mapOrderRow);
}

export interface PaymentRow {
  id: string;
  orderId: string;
  kind: string;
  amountMinor: bigint;
  currency: string;
  killbillPaymentId: string;
  killbillInvoiceId: string;
  capturedAt: Date;
}

export async function listPayments(db: Db, orderId: string): Promise<PaymentRow[]> {
  const result = await db.query('SELECT * FROM payments WHERE order_id = $1 ORDER BY captured_at ASC', [orderId]);
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    orderId: row.order_id as string,
    kind: row.kind as string,
    amountMinor: BigInt(row.amount_minor as string),
    currency: row.currency as string,
    killbillPaymentId: row.killbill_payment_id as string,
    killbillInvoiceId: row.killbill_invoice_id as string,
    capturedAt: new Date(row.captured_at as Date),
  }));
}

export async function refundedTotal(db: Db, paymentId: string): Promise<bigint> {
  const result = await db.query('SELECT COALESCE(SUM(amount_minor), 0) AS total FROM refunds WHERE payment_id = $1', [paymentId]);
  return BigInt((result.rows[0] as { total: string }).total);
}
