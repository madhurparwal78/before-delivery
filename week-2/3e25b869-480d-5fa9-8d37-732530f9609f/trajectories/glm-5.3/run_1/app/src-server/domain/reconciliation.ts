// Reconciliation: a Toronto month of shop records against Kill Bill, with the
// published line kinds, month placement, mismatch filter, accepts and orphan refunds.
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import type { Locale } from "../core/catalog.js";
import { message, fieldMessage } from "../core/copy.js";
import { money, trioPrice } from "../core/money.js";
import { findProvince } from "../core/provinces.js";
import { torontoMonth, nextMonth, torontoMonthStart } from "../core/toronto.js";
import { KillBillClient, KillBillError, centsToKb } from "../services/killbill.js";
import { writeAudit, type AuditActor } from "./audit.js";
import type { ReconciliationLineView } from "./views.js";

export interface LineData {
  key: string;
  kind: "order" | "subscription" | "credit" | "payment";
  shopCents: number | null;
  killbillCents: number | null;
  status: "match" | "mismatch" | "shop_only" | "kb_only" | "accepted" | "refunded";
}

interface SnapshotRow {
  month: string;
  lines: LineData[];
  totals: { shop: { cents: number; currency: "CAD" }; killbill: { cents: number; currency: "CAD" } };
  checked_at: Date;
}

export function monthIsValid(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export async function reconciliation(
  pool: Pool,
  kb: KillBillClient,
  locale: Locale,
  monthInput: string | undefined
): Promise<{ month: string; stale: boolean; checkedAt: string | null; lines: LineData[]; totals: { shopCents: number; killbillCents: number } }> {
  const month = monthInput ?? torontoMonth(new Date());
  if (!monthIsValid(month)) {
    throw new ApiError(422, "invalid", null, { month: fieldMessage("month", locale) });
  }
  try {
    const lines = await buildLines(pool, kb, month);
    const totals = sumLines(lines);
    await saveSnapshot(pool, month, lines, totals);
    return { month, stale: false, checkedAt: new Date().toISOString(), lines, totals };
  } catch (err) {
    if (err instanceof KillBillError) {
      const snapshot = await lastSnapshot(pool, month);
      return {
        month,
        stale: true,
        checkedAt: snapshot ? snapshot.checked_at.toISOString() : null,
        lines: snapshot ? snapshot.lines : [],
        totals: snapshot
          ? { shopCents: snapshot.totals.shop.cents, killbillCents: snapshot.totals.killbill.cents }
          : { shopCents: 0, killbillCents: 0 }
      };
    }
    throw err;
  }
}

function sumLines(lines: LineData[]): { shopCents: number; killbillCents: number } {
  let shop = 0;
  let killbill = 0;
  for (const line of lines) {
    if (line.shopCents !== null) shop += line.shopCents;
    if (line.killbillCents !== null) killbill += line.killbillCents;
  }
  return { shopCents: shop, killbillCents: killbill };
}

function sortLines(lines: LineData[]): LineData[] {
  return lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Build the month's lines from shop records and Kill Bill. */
export async function buildLines(pool: Pool, kb: KillBillClient, month: string): Promise<LineData[]> {
  const client = await pool.connect();
  try {
    const start = torontoMonthStart(month);
    const end = torontoMonthStart(nextMonth(month));
    const lines: LineData[] = [];

    // Order lines: shop = total minus issued refunds; Kill Bill = payment net.
    const orders = await client.query(
      `SELECT o.number, o.total_cents, o.placed_at, c.killbill_account_id
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.placed_at >= $1 AND o.placed_at < $2`,
      [start, end]
    );
    const refundedByOrder = new Map<string, number>();
    const refundRows = await client.query(
      `SELECT r.number AS refund_number, o.number AS order_number, r.amount_cents
       FROM refunds r JOIN orders o ON o.id = r.order_id
       WHERE r.status = 'issued' AND r.created_at >= $1 AND r.created_at < $2`,
      [start, end]
    );
    for (const row of refundRows.rows) {
      refundedByOrder.set(row.order_number, (refundedByOrder.get(row.order_number) ?? 0) + row.amount_cents);
    }
    const acceptedKeys = await acceptedLineKeys(client, month);
    for (const order of orders.rows) {
      const refunded = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM refunds
         WHERE order_id = (SELECT id FROM orders WHERE number = $1) AND status = 'issued'`,
        [order.number]
      );
      const shop = order.total_cents - refunded.rows[0].total;
      const paymentNet = await killbillPaymentNet(kb, order.killbill_account_id, order.number);
      lines.push(makeLine(`order:${order.number}`, "order", shop, paymentNet, acceptedKeys));
    }

    // Subscription lines: shop = the Trio total; Kill Bill = the invoice amount before credit.
    const subscriptions = await client.query(
      `SELECT s.number, s.province, s.killbill_subscription_id, c.killbill_account_id
       FROM subscriptions s JOIN customers c ON c.id = s.customer_id`
    );
    for (const subscription of subscriptions.rows) {
      const invoices = await subscriptionInvoicesForMonth(
        kb, subscription.killbill_account_id, subscription.killbill_subscription_id, month
      );
      for (const invoice of invoices) {
        const amountBeforeCredit = invoice.items
          ?.filter((item) => item.itemType !== "CBA_ADJ")
          .reduce((sum, item) => sum + Math.round(item.amount * 100), 0) ?? 0;
        const shop = trioTotalForProvince(subscription.province);
        lines.push(makeLine(`subscription:${subscription.number}:${invoice.invoiceDate ?? ""}`, "subscription", shop, amountBeforeCredit, acceptedKeys));
      }
    }

    // Credit lines: issued credits this month.
    const credits = await client.query(
      `SELECT number, amount_cents, killbill_ref FROM credits
       WHERE status = 'issued' AND created_at >= $1 AND created_at < $2`,
      [start, end]
    );
    for (const credit of credits.rows) {
      const killbillCents = await killbillCreditAmount(kb, credit.killbill_ref);
      lines.push(makeLine(`credit:${credit.number}`, "credit", credit.amount_cents, killbillCents, acceptedKeys));
    }

    // Payment lines: Kill Bill purchases with no matching shop record.
    const customers = await client.query("SELECT email, killbill_account_id FROM customers WHERE killbill_account_id IS NOT NULL");
    const knownKeys = new Set<string>();
    for (const order of orders.rows) knownKeys.add(order.number);
    const subscriptionPayments = await client.query("SELECT number FROM subscriptions");
    const subscriptionKeys = new Set<string>();
    for (const subscription of subscriptionPayments.rows) {
      const startOn = String(subscription.number);
      subscriptionKeys.add(startOn);
    }
    for (const customer of customers.rows) {
      const payments = await kb.getAccountPayments(customer.killbill_account_id);
      for (const payment of payments) {
        const key = payment.paymentExternalKey ?? "";
        if (!key || knownKeys.has(key) || isSubscriptionPaymentKey(key, subscriptionKeys)) continue;
        const purchase = payment.transactions.find((tx) => tx.transactionType === "PURCHASE" && tx.status === "SUCCESS");
        if (!purchase?.effectiveDate) continue;
        const effective = new Date(purchase.effectiveDate);
        if (effective < start || effective >= end) continue;
        const net = Math.round((payment.purchasedAmount ?? 0) * 100) - Math.round((payment.refundedAmount ?? 0) * 100);
        const refunded = Math.round((payment.refundedAmount ?? 0) * 100);
        const status: LineData["status"] =
          refunded > 0 && net === 0 ? "refunded" : "kb_only";
        lines.push({
          key: `payment:${payment.paymentId}`,
          kind: "payment",
          shopCents: null,
          killbillCents: net,
          status
        });
      }
    }

    return sortLines(lines);
  } finally {
    client.release();
  }
}

function isSubscriptionPaymentKey(key: string, subscriptionNumbers: Set<string>): boolean {
  // Subscription payments are keyed <sub>-<date>.
  const dash = key.lastIndexOf("-");
  if (dash === -1) return false;
  const prefix = key.slice(0, dash);
  return subscriptionNumbers.has(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(key.slice(dash + 1));
}

function makeLine(
  key: string,
  kind: LineData["kind"],
  shop: number,
  killbill: number | null,
  acceptedKeys: Set<string>
): LineData {
  const accepted = acceptedKeys.has(key);
  let status: LineData["status"];
  if (kind === "payment") {
    status = "kb_only";
  } else if (killbill === null) {
    status = "shop_only";
  } else if (accepted) {
    status = shop === killbill ? "accepted" : "mismatch";
  } else {
    status = shop === killbill ? "match" : "mismatch";
  }
  return {
    key,
    kind,
    shopCents: accepted && kind !== "payment" ? killbill : shop,
    killbillCents: killbill,
    status
  };
}

function trioTotalForProvince(province: string): number {
  const taxes = findProvince(province)?.taxes ?? [];
  return trioPrice(taxes).total.cents;
}

async function killbillPaymentNet(kb: KillBillClient, accountId: string | null, orderNumber: string): Promise<number | null> {
  if (!accountId) return null;
  try {
    const payments = await kb.getAccountPayments(accountId);
    const payment = payments.find((candidate) => candidate.paymentExternalKey === orderNumber);
    if (!payment) return null;
    return Math.round((payment.purchasedAmount ?? 0) * 100) - Math.round((payment.refundedAmount ?? 0) * 100);
  } catch {
    return null;
  }
}

async function subscriptionInvoicesForMonth(
  kb: KillBillClient,
  accountId: string | null,
  subscriptionId: string,
  month: string
): Promise<{ invoiceId: string; invoiceDate?: string; items?: { itemType: string; amount: number }[] }[]> {
  if (!accountId || !subscriptionId) return [];
  const summaries = await kb.getInvoices(accountId);
  const found: { invoiceId: string; invoiceDate?: string; items?: { itemType: string; amount: number }[] }[] = [];
  for (const summary of summaries) {
    const invoice = await kb.getInvoice(summary.invoiceId);
    if (invoice.status !== "COMMITTED") continue;
    if (!(invoice.items ?? []).some((item) => item.subscriptionId === subscriptionId)) continue;
    if ((invoice.invoiceDate ?? "").slice(0, 7) !== month) continue;
    found.push(invoice);
  }
  return found;
}

async function killbillCreditAmount(kb: KillBillClient, invoiceId: string | null): Promise<number | null> {
  if (!invoiceId) return null;
  try {
    const invoice = await kb.getInvoice(invoiceId);
    const item = invoice.items?.find((candidate) => candidate.itemType === "CREDIT_ADJ");
    if (!item) return null;
    return Math.round(Math.abs(item.amount) * 100);
  } catch {
    return null;
  }
}

async function acceptedLineKeys(client: PoolClient, month: string): Promise<Set<string>> {
  const res = await client.query(
    "SELECT line_key FROM reconciliation_accepts WHERE month = $1",
    [month]
  );
  return new Set(res.rows.map((row) => row.line_key as string));
}

async function saveSnapshot(pool: Pool, month: string, lines: LineData[], totals: { shopCents: number; killbillCents: number }): Promise<void> {
  await pool.query(
    `INSERT INTO reconciliation_snapshots (month, lines, totals)
     VALUES ($1, $2::jsonb, $3::jsonb)`,
    [month, JSON.stringify(lines), JSON.stringify({ shop: money(totals.shopCents), killbill: money(totals.killbillCents) })]
  );
}

async function lastSnapshot(pool: Pool, month: string): Promise<SnapshotRow | null> {
  const res = await pool.query(
    "SELECT * FROM reconciliation_snapshots WHERE month = $1 ORDER BY created_at DESC LIMIT 1",
    [month]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    month: row.month,
    lines: row.lines as LineData[],
    totals: row.totals as SnapshotRow["totals"],
    checked_at: row.checked_at as Date
  };
}

export async function acceptLine(
  pool: Pool,
  kb: KillBillClient,
  locale: Locale,
  actor: AuditActor,
  month: string,
  key: string
): Promise<{ line: LineData; auditId: number }> {
  const lines = await buildOrSnapshot(pool, kb, locale, month);
  const line = lines.find((candidate) => candidate.key === key);
  if (!line) {
    throw new ApiError(404, "not_found");
  }
  if (line.status !== "mismatch") {
    throw new ApiError(409, "line_not_mismatched");
  }
  if (line.killbillCents === null || line.shopCents === null) {
    throw new ApiError(409, "line_not_mismatched");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO reconciliation_accepts (month, line_key, shop_cents, killbill_cents) VALUES ($1, $2, $3, $4)",
      [month, key, line.shopCents, line.killbillCents]
    );
    const difference = line.killbillCents - line.shopCents;
    const auditId = await writeAudit(
      client, actor, "reconciliation_accept", key, "Accepted Kill Bill figure",
      difference, null, "issued"
    );
    await client.query("COMMIT");
    return {
      line: { ...line, shopCents: line.killbillCents, status: "accepted" },
      auditId
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}

async function buildOrSnapshot(pool: Pool, kb: KillBillClient, locale: Locale, month: string): Promise<LineData[]> {
  if (!monthIsValid(month)) {
    throw new ApiError(422, "invalid", null, { month: fieldMessage("month", locale) });
  }
  try {
    return await buildLines(pool, kb, month);
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable", locale));
    }
    throw err;
  }
}

export async function refundOrphan(
  pool: Pool,
  kb: KillBillClient,
  locale: Locale,
  actor: AuditActor,
  month: string,
  key: string
): Promise<{ line: LineData; refund: { amountCents: number; killbillRef: string }; auditId: number }> {
  const lines = await buildOrSnapshot(pool, kb, locale, month);
  const line = lines.find((candidate) => candidate.key === key);
  if (!line) {
    throw new ApiError(404, "not_found");
  }
  if (line.kind !== "payment" || line.status !== "kb_only") {
    throw new ApiError(409, "line_not_orphan");
  }
  const paymentId = key.slice("payment:".length);
  try {
    const payment = await kb.getPayment(paymentId);
    const net = Math.round((payment.purchasedAmount ?? 0) * 100) - Math.round((payment.refundedAmount ?? 0) * 100);
    await kb.refundPayment(paymentId, {
      amount: centsToKb(net),
      currency: "CAD",
      transactionExternalKey: `orphan:${paymentId}`
    }, actor.email);
    const after = await kb.getPayment(paymentId);
    const refundTx = after.transactions.find((tx) => tx.transactionExternalKey === `orphan:${paymentId}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const auditId = await writeAudit(
      client, actor, "orphan_refund", paymentId, "Orphan payment",
      net, refundTx?.transactionId ?? null, "issued"
    );
    await client.query("COMMIT");
    return {
      line: { ...line, killbillCents: 0, status: "refunded" },
      refund: { amountCents: net, killbillRef: refundTx?.transactionId ?? "" },
      auditId
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable", locale));
    }
    throw err;
  }
}

export function lineView(line: LineData): ReconciliationLineView {
  return {
    key: line.key,
    kind: line.kind,
    shop: line.shopCents === null ? null : money(line.shopCents),
    killbill: line.killbillCents === null ? null : money(line.killbillCents),
    status: line.status
  };
}
