import { CONFLICTS, FIELD_MESSAGES, STUDIO } from '../../../shared/copy.js';
import { money, trioPrice } from '../../../shared/money.js';
import { MONTH_ONLY, torontoMonth } from '../../../shared/toronto.js';
import type {
  Money,
  ProvinceCode,
  ReconciliationKind,
  ReconciliationLine,
  ReconciliationStatus,
} from '../../../shared/types.js';
import { db, withTransaction } from '../../db/pool.js';
import { boundedText, parseBody, type Reader } from '../../http/body.js';
import type { ApiResponse, RequestContext } from '../../http/context.js';
import { errors } from '../../http/errors.js';
import { noteBillingFailure } from '../../services/billing-status.js';
import {
  BillingUnavailableError,
  killbill,
  killbillAmountToCents,
  type KillBillInvoice,
  type KillBillPayment,
} from '../../services/killbill.js';
import { orderedReconciliationLine, sumMoney } from '../../repo/normalize.js';
import { requireRole } from '../sessions.js';
import { writeAudit } from './finance.js';

const FINANCE = ['maker', 'finance'] as const;

const readMonth: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !MONTH_ONLY.test(raw) || Number(raw.slice(5)) > 12 || Number(raw.slice(5)) < 1) {
    report(path, FIELD_MESSAGES.month);
    return torontoMonth(new Date());
  }
  return raw;
};

const ACTION_SHAPE = {
  month: readMonth,
  key: boundedText(FIELD_MESSAGES.unknown_key, 1, 120),
} as const;

type AccountSnapshot = {
  accountId: string;
  payments: KillBillPayment[];
  invoices: KillBillInvoice[];
};

async function readKillBill(actor: string): Promise<AccountSnapshot[]> {
  const accounts = await db.query<{ killbill_account_id: string }>(
    'SELECT killbill_account_id FROM customers WHERE killbill_account_id IS NOT NULL',
  );
  const snapshots: AccountSnapshot[] = [];
  for (const row of accounts.rows) {
    snapshots.push({
      accountId: row.killbill_account_id,
      payments: await killbill.accountPayments(row.killbill_account_id, actor),
      invoices: await killbill.accountInvoices(row.killbill_account_id, actor),
    });
  }
  return snapshots;
}

function purchaseOf(payment: KillBillPayment): { effectiveDate: string } | null {
  const purchase = payment.transactions.find(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );
  return purchase ? { effectiveDate: purchase.effectiveDate } : null;
}

function netOf(payment: KillBillPayment): number {
  return killbillAmountToCents(payment.purchasedAmount) - killbillAmountToCents(payment.refundedAmount);
}

function statusFor(shop: Money | null, kb: Money | null, kind: ReconciliationKind): ReconciliationStatus {
  if (kind === 'payment') return 'kb_only';
  if (kb === null) return 'shop_only';
  if (shop === null) return 'kb_only';
  return shop.cents === kb.cents ? 'match' : 'mismatch';
}

export type ReconciliationReport = {
  month: string;
  lines: ReconciliationLine[];
  totals: { shop: Money; killbill: Money };
};

async function buildReport(month: string, actor: string): Promise<ReconciliationReport> {
  const snapshots = await readKillBill(actor);
  const payments = snapshots.flatMap((snapshot) => snapshot.payments);
  const invoices = snapshots.flatMap((snapshot) => snapshot.invoices);
  const paymentByKey = new Map(payments.map((payment) => [payment.paymentExternalKey, payment]));
  const invoiceById = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));

  const accepts = await db.query<{ key: string; accepted_cents: number }>(
    'SELECT key, accepted_cents FROM reconciliation_accepts',
  );
  const acceptedByKey = new Map(accepts.rows.map((row) => [row.key, row.accepted_cents]));
  const refundedOrphans = await db.query<{ payment_id: string }>(
    'SELECT payment_id FROM orphan_refunds',
  );
  const refundedOrphanIds = new Set(refundedOrphans.rows.map((row) => row.payment_id));

  const lines: ReconciliationLine[] = [];

  const orders = await db.query<{
    number: string;
    placed_at: Date;
    total_cents: number;
    refunded_cents: string | null;
  }>(
    `SELECT o.number, o.placed_at, o.total_cents,
            (SELECT sum(amount_cents)::text FROM refunds r
              WHERE r.order_number = o.number AND r.status = 'issued') AS refunded_cents
       FROM orders o`,
  );
  for (const order of orders.rows) {
    if (torontoMonth(order.placed_at) !== month) continue;
    const shop = money(order.total_cents - Number(order.refunded_cents ?? 0));
    const payment = paymentByKey.get(order.number);
    lines.push({
      key: `order:${order.number}`,
      kind: 'order',
      shop,
      killbill: payment ? money(netOf(payment)) : null,
      status: 'match',
    });
  }

  const subscriptionInvoices = await db.query<{
    subscription_number: string;
    killbill_invoice_id: string;
    invoice_date: string;
    province: ProvinceCode;
  }>(
    `SELECT i.subscription_number, i.killbill_invoice_id, i.invoice_date,
            (s.shipping ->> 'province') AS province
       FROM subscription_invoices i
       JOIN subscriptions s ON s.number = i.subscription_number`,
  );
  for (const invoice of subscriptionInvoices.rows) {
    if (invoice.invoice_date.slice(0, 7) !== month) continue;
    const killbillInvoice = invoiceById.get(invoice.killbill_invoice_id);
    lines.push({
      key: `subscription:${invoice.subscription_number}:${invoice.invoice_date}`,
      kind: 'subscription',
      shop: trioPrice(invoice.province).total,
      killbill: killbillInvoice ? money(killbillAmountToCents(killbillInvoice.amount)) : null,
      status: 'match',
    });
  }

  const credits = await db.query<{ number: string; amount_cents: number; created_at: Date }>(
    `SELECT number, amount_cents, created_at FROM credits WHERE status = 'issued'`,
  );
  for (const credit of credits.rows) {
    if (torontoMonth(credit.created_at) !== month) continue;
    const recorded = invoices
      .flatMap((invoice) => invoice.items)
      .find((item) => item.itemType === 'CREDIT_ADJ' && item.description === `Goodwill ${credit.number}`);
    lines.push({
      key: `credit:${credit.number}`,
      kind: 'credit',
      shop: money(credit.amount_cents),
      killbill: recorded ? money(Math.abs(killbillAmountToCents(recorded.amount))) : null,
      status: 'match',
    });
  }

  const orderNumbers = new Set(orders.rows.map((order) => order.number));
  const subscriptionKeys = new Set(
    (
      await db.query<{ payment_key: string }>('SELECT payment_key FROM subscription_invoices')
    ).rows.map((row) => row.payment_key),
  );
  for (const payment of payments) {
    if (orderNumbers.has(payment.paymentExternalKey)) continue;
    if (subscriptionKeys.has(payment.paymentExternalKey)) continue;
    const purchase = purchaseOf(payment);
    if (!purchase) continue;
    if (torontoMonth(new Date(purchase.effectiveDate)) !== month) continue;
    lines.push({
      key: `payment:${payment.paymentId}`,
      kind: 'payment',
      shop: null,
      killbill: money(netOf(payment)),
      status: refundedOrphanIds.has(payment.paymentId) ? 'refunded' : 'kb_only',
    });
  }

  for (const line of lines) {
    if (line.kind === 'payment') continue;
    const accepted = acceptedByKey.get(line.key);
    if (accepted !== undefined) {
      line.shop = money(accepted);
      line.status = line.killbill?.cents === accepted ? 'accepted' : 'mismatch';
      continue;
    }
    line.status = statusFor(line.shop, line.killbill, line.kind);
  }

  lines.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return {
    month,
    lines,
    totals: {
      shop: sumMoney(lines.map((line) => line.shop)),
      killbill: sumMoney(lines.map((line) => line.killbill)),
    },
  };
}

export async function getReconciliation(ctx: RequestContext): Promise<ApiResponse> {
  const staff = requireRole(ctx, FINANCE);
  const raw = ctx.query.get('month');
  const month = raw === null || raw === '' ? torontoMonth(new Date()) : raw;
  if (!MONTH_ONLY.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) {
    throw errors.invalid({ month: FIELD_MESSAGES.month });
  }
  try {
    const report = await buildReport(month, staff.email);
    const checkedAt = new Date();
    await db.query(
      `INSERT INTO reconciliation_snapshots (month, checked_at, lines) VALUES ($1, $2, $3)
       ON CONFLICT (month) DO UPDATE SET checked_at = EXCLUDED.checked_at, lines = EXCLUDED.lines`,
      [month, checkedAt, JSON.stringify(report.lines)],
    );
    return {
      status: 200,
      body: {
        month,
        stale: false,
        checked_at: checkedAt.toISOString(),
        lines: report.lines,
        totals: report.totals,
      },
    };
  } catch (error) {
    if (!(error instanceof BillingUnavailableError)) throw error;
    noteBillingFailure();
    const snapshot = await db.query<{ checked_at: Date; lines: ReconciliationLine[] }>(
      'SELECT checked_at, lines FROM reconciliation_snapshots WHERE month = $1',
      [month],
    );
    const row = snapshot.rows[0];
    const lines = (row?.lines ?? []).map(orderedReconciliationLine);
    return {
      status: 200,
      body: {
        month,
        stale: true,
        checked_at: row ? row.checked_at.toISOString() : null,
        lines,
        totals: {
          shop: sumMoney(lines.map((line) => line.shop)),
          killbill: sumMoney(lines.map((line) => line.killbill)),
        },
      },
    };
  }
}

export async function acceptKillBillFigure(ctx: RequestContext): Promise<ApiResponse> {
  const staff = requireRole(ctx, FINANCE);
  const parsed = parseBody(ctx.body, ACTION_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const { month, key } = parsed.value;
  let report: ReconciliationReport;
  try {
    report = await buildReport(month, staff.email);
  } catch (error) {
    if (!(error instanceof BillingUnavailableError)) throw error;
    noteBillingFailure();
    throw errors.billingUnavailable(STUDIO.billingUnavailable);
  }
  const line = report.lines.find((candidate) => candidate.key === key);
  if (!line) throw errors.notFound();
  if (line.status !== 'mismatch') {
    throw errors.conflict('line_not_mismatched', CONFLICTS.lineNotMismatched);
  }
  const killbillFigure = line.killbill;
  if (!killbillFigure) throw errors.notFound();
  const difference = money(killbillFigure.cents - (line.shop?.cents ?? 0));
  const audit = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO reconciliation_accepts (key, month, accepted_cents) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET month = EXCLUDED.month, accepted_cents = EXCLUDED.accepted_cents, at = now()`,
      [key, month, killbillFigure.cents],
    );
    return writeAudit(client, {
      actor: staff.email,
      role: staff.role,
      action: 'reconciliation_accept',
      target: key,
      reason: 'Accepted Kill Bill figure',
      amount: difference,
      killbillRef: null,
      outcome: 'issued',
    });
  });
  return {
    status: 200,
    body: {
      line: { ...line, shop: killbillFigure, status: 'accepted' satisfies ReconciliationStatus },
      audit,
    },
  };
}

export async function refundOrphanPayment(ctx: RequestContext): Promise<ApiResponse> {
  const staff = requireRole(ctx, FINANCE);
  const parsed = parseBody(ctx.body, ACTION_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const { key } = parsed.value;
  if (!key.startsWith('payment:')) throw errors.notFound();
  const paymentId = key.slice('payment:'.length);
  let payment: KillBillPayment;
  try {
    payment = await killbill.getPayment(paymentId, staff.email);
  } catch (error) {
    if (!(error instanceof BillingUnavailableError)) throw error;
    noteBillingFailure();
    throw errors.billingUnavailable(STUDIO.billingUnavailable);
  }
  const orderMatch = await db.query('SELECT 1 FROM orders WHERE number = $1', [
    payment.paymentExternalKey,
  ]);
  const subscriptionMatch = await db.query(
    'SELECT 1 FROM subscription_invoices WHERE payment_key = $1',
    [payment.paymentExternalKey],
  );
  if (orderMatch.rowCount !== 0 || subscriptionMatch.rowCount !== 0) {
    throw errors.conflict('line_not_orphan', CONFLICTS.lineNotOrphan);
  }
  const amount = money(netOf(payment));
  if (amount.cents <= 0) throw errors.conflict('line_not_orphan', CONFLICTS.lineNotOrphan);
  let killbillRef: string;
  try {
    killbillRef = await killbill.refundWithItemAdjustments({
      paymentId,
      amountCents: amount.cents,
      adjustments: [],
      actor: staff.email,
    });
  } catch (error) {
    if (!(error instanceof BillingUnavailableError)) throw error;
    noteBillingFailure();
    throw errors.billingUnavailable(STUDIO.billingUnavailable);
  }
  const audit = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO orphan_refunds (payment_id, amount_cents, killbill_ref) VALUES ($1, $2, $3)
       ON CONFLICT (payment_id) DO NOTHING`,
      [paymentId, amount.cents, killbillRef],
    );
    return writeAudit(client, {
      actor: staff.email,
      role: staff.role,
      action: 'orphan_refund',
      target: paymentId,
      reason: 'Orphan payment',
      amount,
      killbillRef,
      outcome: 'issued',
    });
  });
  return {
    status: 200,
    body: {
      line: {
        key,
        kind: 'payment' satisfies ReconciliationKind,
        shop: null,
        killbill: money(0),
        status: 'refunded' satisfies ReconciliationStatus,
      },
      refund: { amount, killbill_ref: killbillRef },
      audit,
    },
  };
}
