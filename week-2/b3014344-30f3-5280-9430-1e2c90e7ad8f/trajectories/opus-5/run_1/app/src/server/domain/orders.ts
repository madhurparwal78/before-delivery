import { type PoolClient } from "pg";
import { query, queryOne } from "../db.js";
import { errors } from "../errors.js";
import { studioInstant } from "../time.js";
import { type Currency, type Money, money, toAmountString } from "../../shared/money.js";
import { type CareTier, type PlanId, isCarePlan, planName } from "../../shared/plans.js";

export type OrderState =
  | "quoted"
  | "accepted"
  | "deposit_paid"
  | "in_build"
  | "balance_invoiced"
  | "paid_in_full"
  | "closed";

export type PaymentKind = "deposit" | "balance" | "care" | "change" | "renewal";

export interface OrderRow {
  id: string;
  number: string;
  sessionId: string | null;
  accountId: string | null;
  plan: PlanId;
  currency: Currency;
  state: OrderState;
  total: Money;
  dueNow: Money;
  dueAtLaunch: Money;
  priceRowId: string | null;
  priceEffectiveAt: Date | null;
  acceptedAt: Date | null;
  depositInvoiceId: string | null;
  balanceInvoiceId: string | null;
  careSubscriptionId: string | null;
  careBundleId: string | null;
  careTier: CareTier | null;
  createdAt: Date;
}

interface OrderRecord {
  id: string;
  number: string;
  session_id: string | null;
  account_id: string | null;
  plan: string;
  currency: string;
  state: string;
  total_minor: string;
  deposit_minor: string;
  balance_minor: string;
  price_row_id: string | null;
  price_effective_at: Date | null;
  accepted_at: Date | null;
  deposit_invoice_id: string | null;
  balance_invoice_id: string | null;
  care_subscription_id: string | null;
  care_bundle_id: string | null;
  care_tier: string | null;
  created_at: Date;
}

const ORDER_COLUMNS = `id, number, session_id, account_id, plan, currency, state, total_minor, deposit_minor,
  balance_minor, price_row_id, price_effective_at, accepted_at, deposit_invoice_id, balance_invoice_id,
  care_subscription_id, care_bundle_id, care_tier, created_at`;

export function toOrderRow(record: OrderRecord): OrderRow {
  const currency = record.currency as Currency;
  return {
    id: record.id,
    number: record.number,
    sessionId: record.session_id,
    accountId: record.account_id,
    plan: record.plan as PlanId,
    currency,
    state: record.state as OrderState,
    total: money(currency, BigInt(record.total_minor)),
    dueNow: money(currency, BigInt(record.deposit_minor)),
    dueAtLaunch: money(currency, BigInt(record.balance_minor)),
    priceRowId: record.price_row_id,
    priceEffectiveAt: record.price_effective_at,
    acceptedAt: record.accepted_at,
    depositInvoiceId: record.deposit_invoice_id,
    balanceInvoiceId: record.balance_invoice_id,
    careSubscriptionId: record.care_subscription_id,
    careBundleId: record.care_bundle_id,
    careTier: record.care_tier as CareTier | null,
    createdAt: record.created_at,
  };
}

export async function orderById(id: string): Promise<OrderRow | null> {
  const record = await queryOne<OrderRecord>(`select ${ORDER_COLUMNS} from orders where id = $1`, [id]);
  return record ? toOrderRow(record) : null;
}

export async function orderByIdForUpdate(client: PoolClient, id: string): Promise<OrderRow | null> {
  const result = await client.query<OrderRecord>(
    `select ${ORDER_COLUMNS} from orders where id = $1 for update`,
    [id],
  );
  const record = result.rows[0];
  return record ? toOrderRow(record) : null;
}

export async function ordersOfAccount(accountId: string): Promise<OrderRow[]> {
  const records = await query<OrderRecord>(
    `select ${ORDER_COLUMNS} from orders where account_id = $1 order by created_at asc`,
    [accountId],
  );
  return records.map(toOrderRow);
}

export async function allOrders(): Promise<OrderRow[]> {
  const records = await query<OrderRecord>(
    `select ${ORDER_COLUMNS} from orders where account_id is not null order by number asc`,
  );
  return records.map(toOrderRow);
}

export async function careOrderOfAccount(accountId: string): Promise<OrderRow | null> {
  const record = await queryOne<OrderRecord>(
    `select ${ORDER_COLUMNS} from orders
      where account_id = $1 and care_subscription_id is not null
      order by created_at desc limit 1`,
    [accountId],
  );
  return record ? toOrderRow(record) : null;
}

export async function nextOrderNumber(): Promise<string> {
  const row = await queryOne<{ value: string }>(`select nextval('order_number_seq') as value`);
  const value = Number(row?.value ?? "1");
  return `PB-${value.toString().padStart(4, "0")}`;
}

const ALLOWED: Record<OrderState, OrderState[]> = {
  quoted: ["accepted"],
  accepted: ["deposit_paid", "paid_in_full"],
  deposit_paid: ["in_build"],
  in_build: ["balance_invoiced"],
  balance_invoiced: ["paid_in_full"],
  paid_in_full: ["closed"],
  closed: [],
};

/** The one place an order's moves are decided. */
export function canMove(order: OrderRow, to: OrderState): boolean {
  if (!ALLOWED[order.state].includes(to)) return false;
  if (to === "paid_in_full" && order.state === "accepted") return isCarePlan(order.plan);
  if (to === "deposit_paid" && isCarePlan(order.plan)) return false;
  if (to === "closed") return !isCarePlan(order.plan);
  return true;
}

export function assertMove(order: OrderRow, to: OrderState): void {
  if (!canMove(order, to)) throw errors.invalidTransition(order.state);
}

export interface PaymentView {
  id: string;
  kind: PaymentKind;
  amount: Money;
  refunded: Money;
  remaining: Money;
  capturedAt: Date;
  killbillPaymentId: string;
  killbillInvoiceId: string | null;
}

interface PaymentRecord {
  id: string;
  kind: string;
  amount_minor: string;
  currency: string;
  killbill_payment_id: string;
  killbill_invoice_id: string | null;
  captured_at: Date;
  refunded_minor: string | null;
}

export async function paymentsOfOrder(orderId: string): Promise<PaymentView[]> {
  const records = await query<PaymentRecord>(
    `select p.id, p.kind, p.amount_minor, p.currency, p.killbill_payment_id, p.killbill_invoice_id,
            p.captured_at,
            coalesce(sum(r.amount_minor), 0)::text as refunded_minor
       from payments p
       left join refunds r on r.payment_id = p.id
      where p.order_id = $1
      group by p.id
      order by p.captured_at asc`,
    [orderId],
  );
  return records.map((record) => {
    const currency = record.currency as Currency;
    const amount = money(currency, BigInt(record.amount_minor));
    const refunded = money(currency, BigInt(record.refunded_minor ?? "0"));
    return {
      id: record.id,
      kind: record.kind as PaymentKind,
      amount,
      refunded,
      remaining: money(currency, amount.minor - refunded.minor),
      capturedAt: record.captured_at,
      killbillPaymentId: record.killbill_payment_id,
      killbillInvoiceId: record.killbill_invoice_id,
    };
  });
}

export async function latestPaymentOfOrder(orderId: string): Promise<PaymentView | null> {
  const payments = await paymentsOfOrder(orderId);
  return payments[payments.length - 1] ?? null;
}

export async function projectIdOfOrder(orderId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(`select id from projects where order_id = $1`, [orderId]);
  return row?.id ?? null;
}

export function serializeOrder(
  order: OrderRow,
  payments: PaymentView[],
  projectId: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: order.id,
    number: order.number,
    accountId: order.accountId,
    plan: order.plan,
    planName: planName(order.plan),
    currency: order.currency,
    state: order.state,
    total: toAmountString(order.total),
    dueNow: toAmountString(order.dueNow),
    dueAtLaunch: toAmountString(order.dueAtLaunch),
    acceptedAt: order.acceptedAt ? studioInstant(order.acceptedAt) : null,
    projectId,
    payments: payments
      .filter((payment) => payment.kind === "deposit" || payment.kind === "balance" || payment.kind === "care")
      .map((payment) => ({
        kind: payment.kind,
        amount: toAmountString(payment.amount),
        refunded: toAmountString(payment.refunded),
        remaining: toAmountString(payment.remaining),
        capturedAt: studioInstant(payment.capturedAt),
        killbillPaymentId: payment.killbillPaymentId,
      })),
    ...extra,
  };
}

export async function orderView(order: OrderRow, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const payments = await paymentsOfOrder(order.id);
  const projectId = await projectIdOfOrder(order.id);
  return serializeOrder(order, payments, projectId, extra);
}
