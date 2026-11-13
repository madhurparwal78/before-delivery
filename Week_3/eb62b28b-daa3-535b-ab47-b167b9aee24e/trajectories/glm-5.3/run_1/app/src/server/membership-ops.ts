import type { AppContext } from "./route-context.js";
import type { Database } from "./db.js";
import type { Cadence } from "../shared/enums.js";
import { ApiError } from "./errors.js";
import { copy } from "../shared/copy.js";
import { membershipFor, type MembershipRow } from "./memberships.js";
import type { KbInvoice, KbPayment } from "./killbill.js";
import { centsFromDecimalString } from "../shared/money.js";

export const PLAN_FOR_CADENCE: Record<Cadence, string> = {
  sixMonths: "plus-six-months",
  yearly: "plus-yearly",
};

export const CADENCE_FOR_PLAN: Record<string, Cadence> = {
  "plus-six-months": "sixMonths",
  "plus-yearly": "yearly",
};

const JOIN_WAIT_MS = 10_000;

/**
 * A join: create the Kill Bill account and subscription, wait up to 10 seconds
 * for the first invoice to be paid, and record the membership.
 */
export async function joinPlus(
  ctx: AppContext,
  member: { id: string; name: string; email: string },
  cadence: Cadence
): Promise<MembershipRow> {
  const account = await ctx.killbill.createAccount(member);
  await ctx.killbill.ensureExternalPaymentMethod(account.accountId);
  const subscription = await ctx.killbill.createSubscription(account.accountId, PLAN_FOR_CADENCE[cadence]);
  const started = Date.now();
  let paid = false;
  let chargedThrough: string | null = null;
  while (Date.now() - started < JOIN_WAIT_MS) {
    paid = await firstInvoicePaid(ctx, account.accountId);
    const fresh = await ctx.killbill.getSubscription(subscription.subscriptionId);
    chargedThrough = fresh?.chargedThroughDate ?? chargedThrough;
    if (paid && chargedThrough) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!chargedThrough) {
    const fresh = await ctx.killbill.getSubscription(subscription.subscriptionId);
    chargedThrough = fresh?.chargedThroughDate ?? null;
  }
  const state = paid ? "active" : "pending";
  await ctx.db.exec(
    `UPDATE memberships
     SET state = $2, cadence = $3, kb_subscription_id = $4, kb_plan_name = $5,
         kb_charged_through = $6, renewal_date = $6, join_requested_at = now()
     WHERE member_id = $1`,
    [member.id, state, cadence, subscription.subscriptionId, PLAN_FOR_CADENCE[cadence], chargedThrough]
  );
  if (paid) {
    await recordPaidInvoices(ctx, member.id, account.accountId);
  }
  const row = await membershipFor(ctx.db, member.id);
  if (!row) throw new ApiError(500, "internal_error", "Something went wrong.");
  return row;
}

async function firstInvoicePaid(ctx: AppContext, accountId: string): Promise<boolean> {
  const invoices = await ctx.killbill.listInvoices(accountId);
  if (invoices.length === 0) return false;
  for (const listed of invoices) {
    const invoice = await ctx.killbill.getInvoice(listed.invoiceId);
    if (!invoice || invoice.amount <= 0) continue;
    const payments = await ctx.killbill.listPaymentsForInvoice(listed.invoiceId);
    if (payments.some((payment) => payment.purchasedAmount >= invoice.amount - 0.001)) {
      return true;
    }
  }
  return false;
}

/** Look at Kill Bill for paid invoices not yet recorded as receipts. */
export async function recordPaidInvoices(ctx: AppContext, memberId: string, accountId: string): Promise<void> {
  const listed = await ctx.killbill.listInvoices(accountId);
  for (const entry of listed) {
    const invoice = await ctx.killbill.getInvoice(entry.invoiceId);
    if (!invoice || invoice.amount <= 0) continue;
    const existing = await ctx.db.one<{ id: string }>(
      `SELECT id FROM receipts WHERE invoice_id = $1`,
      [invoice.invoiceId]
    );
    if (existing) continue;
    const payments = await ctx.killbill.listPaymentsForInvoice(invoice.invoiceId);
    const paid = payments.find((p) => p.purchasedAmount >= invoice.amount - 0.001);
    if (!paid) continue;
    await insertReceipt(ctx.db, memberId, invoice, paid);
  }
}

export async function insertReceipt(
  db: Database,
  memberId: string,
  invoice: KbInvoice,
  payment: KbPayment
): Promise<void> {
  const member = await db.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [memberId]);
  const number = await nextReceiptNumber(db);
  const paidAt = payment.transactions.find((t) => t.status === "SUCCESS")?.effectiveDate ?? new Date().toISOString();
  const paidDate = new Date(paidAt).toISOString().slice(0, 10);
  const items = invoice.items.map((item) => ({
    description: item.description ?? item.itemType,
    periodStart: item.startDate ?? paidDate,
    periodEnd: item.endDate ?? paidDate,
    amountCents: centsFromDecimalString(item.amount.toFixed(2)),
  }));
  await db.exec(
    `INSERT INTO receipts (id, number, member_id, member_name, invoice_id, paid_at, paid_date, amount_cents, currency, items)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      `rcpt_${number}`,
      number,
      memberId,
      member?.name ?? "Erased member",
      invoice.invoiceId,
      new Date(paidAt),
      paidDate,
      centsFromDecimalString(invoice.amount.toFixed(2)),
      invoice.currency ?? "USD",
      JSON.stringify(items),
    ]
  );
}

async function nextReceiptNumber(db: Database): Promise<string> {
  const row = await db.one<{ max: string | null }>(`SELECT max(number) AS max FROM receipts`);
  const current = row?.max ? Number(row.max.replace("OLC-", "")) : 0;
  const next = current + 1;
  return `OLC-${String(next).padStart(6, "0")}`;
}

/** Check Kill Bill for a pending membership; called on reads and a 60-second timer. */
export async function refreshPendingMembership(
  ctx: AppContext,
  memberId: string
): Promise<MembershipRow | null> {
  const row = await membershipFor(ctx.db, memberId);
  if (!row) return null;
  const account = await ctx.killbill.getAccountByExternalKey(memberId);
  if (!account) return row;
  if (row.state === "pending" && row.kb_subscription_id) {
    const sub = await ctx.killbill.getSubscription(row.kb_subscription_id);
    if (sub && sub.state === "ACTIVE") {
      const paid = await firstInvoicePaidForAccount(ctx, account.accountId);
      if (paid && sub.chargedThroughDate) {
        await ctx.db.exec(
          `UPDATE memberships SET state = 'active', renewal_date = $2, kb_charged_through = $2, last_kb_check_at = now() WHERE member_id = $1`,
          [memberId, sub.chargedThroughDate]
        );
        await recordPaidInvoices(ctx, memberId, account.accountId);
        return membershipFor(ctx.db, memberId);
      }
    }
  } else if ((row.state === "active" || row.state === "cancelled") && row.kb_subscription_id) {
    const sub = await ctx.killbill.getSubscription(row.kb_subscription_id);
    if (sub && sub.chargedThroughDate) {
      await ctx.db.exec(
        `UPDATE memberships SET renewal_date = $2, kb_charged_through = $2, last_kb_check_at = now() WHERE member_id = $1`,
        [memberId, sub.chargedThroughDate]
      );
      await recordPaidInvoices(ctx, memberId, account.accountId);
      return membershipFor(ctx.db, memberId);
    }
  }
  await ctx.db.exec(`UPDATE memberships SET last_kb_check_at = now() WHERE member_id = $1`, [memberId]);
  return row;
}

async function firstInvoicePaidForAccount(ctx: AppContext, accountId: string): Promise<boolean> {
  return firstInvoicePaid(ctx, accountId);
}

/** Cadence change: pending now, applied at the next renewal by Kill Bill. */
export async function changeCadence(
  ctx: AppContext,
  memberId: string,
  subscriptionId: string,
  cadence: Cadence
): Promise<void> {
  await ctx.killbill.changePlanEndOfTerm(subscriptionId, PLAN_FOR_CADENCE[cadence]);
  const row = await membershipFor(ctx.db, memberId);
  await ctx.db.exec(
    `UPDATE memberships SET pending_cadence = $2, pending_from = $3 WHERE member_id = $1`,
    [memberId, cadence, row?.renewal_date ?? null]
  );
}

/** Cancel: end of term in Kill Bill; Plus stays until plusUntil. */
export async function cancelPlus(
  ctx: AppContext,
  memberId: string,
  subscriptionId: string
): Promise<void> {
  await ctx.killbill.cancelEndOfTerm(subscriptionId);
  const sub = await ctx.killbill.getSubscription(subscriptionId);
  const chargedThrough = sub?.chargedThroughDate ?? sub?.cancelledDate?.slice(0, 10) ?? null;
  await ctx.db.exec(
    `UPDATE memberships SET state = 'cancelled', plus_until = $2, pending_cadence = NULL, pending_from = NULL
     WHERE member_id = $1`,
    [memberId, chargedThrough]
  );
}

/** Restore: undo the end-of-term cancellation in Kill Bill. */
export async function uncancelPlus(
  ctx: AppContext,
  subscriptionId: string
): Promise<void> {
  await ctx.killbill.uncancel(subscriptionId);
}

/** A cheap reachability check used before actions that need Kill Bill. */
export async function killBillReachable(ctx: AppContext): Promise<boolean> {
  try {
    const result = await ctx.killbill.request("GET", "/1.0/kb/tenants");
    return result.status < 500;
  } catch {
    return false;
  }
}

export function paymentsUnavailable(): ApiError {
  return new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
}
