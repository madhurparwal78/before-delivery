import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db.js";
import { errors } from "../errors.js";
import { config } from "../config.js";
import { addDaysToDate, daysBetween, studioDate, studioDateOf, studioInstant } from "../time.js";
import * as killbill from "../services/killbill.js";
import { type Currency, type Money, absMoney, money, sharePercent, toAmountString } from "../../shared/money.js";
import { type CareTier, carePlanId, planName } from "../../shared/plans.js";
import { type OrderRow, careOrderOfAccount } from "./orders.js";
import { priceInEffect } from "./prices.js";

export type PlanStatus = "active" | "paused" | "pending_cancel" | "past_due" | "cancelled";

export interface PlanView {
  id: string;
  tier: CareTier;
  planName: string;
  status: PlanStatus;
  currency: Currency;
  monthlyPrice: Money;
  periodStart: string | null;
  chargedThrough: string | null;
  pauseOn: string | null;
  endsOn: string | null;
  failedAttempts: number;
  nextRetryAt: Date | null;
  orderId: string;
  subscriptionId: string;
  bundleId: string;
  openRenewalInvoice: killbill.KbInvoice | null;
}

export interface CarePlanContext {
  order: OrderRow;
  subscriptionId: string;
  bundleId: string;
}

export async function carePlanContext(accountId: string): Promise<CarePlanContext | null> {
  const order = await careOrderOfAccount(accountId);
  if (!order?.careSubscriptionId || !order.careBundleId) return null;
  return { order, subscriptionId: order.careSubscriptionId, bundleId: order.careBundleId };
}

function scheduledPause(subscription: killbill.KbSubscription, today: string): { pausedNow: boolean; pauseOn: string | null } {
  const relevant = subscription.events.filter(
    (event) => event.eventType === "PAUSE_ENTITLEMENT" || event.eventType === "RESUME_ENTITLEMENT",
  );
  const last = relevant[relevant.length - 1];
  if (!last || last.eventType !== "PAUSE_ENTITLEMENT") return { pausedNow: false, pauseOn: null };
  const date = studioDateOf(last.effectiveDate);
  if (!date) return { pausedNow: false, pauseOn: null };
  if (date <= today) return { pausedNow: true, pauseOn: null };
  return { pausedNow: false, pauseOn: date };
}

/** The one place a care plan's status is read out of Kill Bill's own state. */
export async function planView(context: CarePlanContext): Promise<PlanView> {
  const subscription = await killbill.getSubscription(context.subscriptionId);
  const account = await queryOne<{ killbill_account_id: string | null }>(
    `select killbill_account_id from client_accounts where id = $1`,
    [context.order.accountId],
  );
  const killbillAccountId = account?.killbill_account_id;
  if (!killbillAccountId) throw errors.notFound();
  const invoices = await killbill.listInvoices(killbillAccountId);
  const mine = invoices.filter((invoice) =>
    invoice.items.some((item) => item.subscriptionId === context.subscriptionId),
  );
  const openRenewal =
    mine
      .filter((invoice) => invoice.status !== "VOID" && invoice.balance.minor > 0n)
      .sort((left, right) => left.invoiceDate.localeCompare(right.invoiceDate))[0] ?? null;

  const today = studioDate(new Date());
  const pause = scheduledPause(subscription, today);
  const chargedThrough = studioDateOf(subscription.chargedThroughDate);
  const billingEnd = studioDateOf(subscription.billingEndDate);

  const attempts = await query<{ attempt_no: number; outcome: string | null; due_at: Date; ran_at: Date | null }>(
    `select attempt_no, outcome, due_at, ran_at from dunning_attempts
      where order_id = $1
        and killbill_invoice_id = coalesce($2, (
          select killbill_invoice_id from dunning_attempts where order_id = $1 order by due_at desc limit 1
        ))
      order by attempt_no asc`,
    [context.order.id, openRenewal?.invoiceId ?? null],
  );
  const failedAttempts = attempts.filter((attempt) => attempt.outcome === "failed").length;
  const nextRetry = attempts.find((attempt) => attempt.ran_at === null)?.due_at ?? null;

  let status: PlanStatus;
  if (subscription.state === "CANCELLED") {
    status = "cancelled";
  } else if (pause.pausedNow || subscription.state === "BLOCKED") {
    status = "paused";
  } else if (billingEnd && billingEnd > today) {
    status = "pending_cancel";
  } else if (billingEnd && billingEnd <= today) {
    status = "cancelled";
  } else if (failedAttempts > 0 && openRenewal) {
    status = "past_due";
  } else {
    status = "active";
  }

  const recurringStarts = mine
    .flatMap((invoice) => invoice.items)
    .filter((item) => item.itemType === "RECURRING" && item.startDate)
    .map((item) => item.startDate as string)
    .sort();
  const periodStart = recurringStarts[recurringStarts.length - 1] ?? null;

  const tier = (context.order.careTier ?? (subscription.productName === "care-plus" ? "plus" : "lite")) as CareTier;
  return {
    id: context.subscriptionId,
    tier,
    planName: planName(carePlanId(tier)),
    status,
    currency: context.order.currency,
    monthlyPrice: context.order.total,
    periodStart,
    chargedThrough,
    pauseOn: pause.pauseOn,
    endsOn: billingEnd,
    failedAttempts,
    nextRetryAt: nextRetry,
    orderId: context.order.id,
    subscriptionId: context.subscriptionId,
    bundleId: context.bundleId,
    openRenewalInvoice: openRenewal,
  };
}

export function serializePlan(plan: PlanView): Record<string, unknown> {
  return {
    id: plan.id,
    tier: plan.tier,
    planName: plan.planName,
    status: plan.status,
    currency: plan.currency,
    monthlyPrice: toAmountString(plan.monthlyPrice),
    periodStart: plan.periodStart,
    chargedThrough: plan.chargedThrough,
    pauseOn: plan.pauseOn,
    endsOn: plan.endsOn,
    failedAttempts: plan.failedAttempts,
    nextRetryAt: plan.nextRetryAt ? studioInstant(plan.nextRetryAt) : null,
  };
}

export interface PreviewView {
  id: string;
  fromTier: CareTier;
  toTier: CareTier;
  currency: Currency;
  credit: Money;
  charge: Money;
  total: Money;
  daysLeft: number;
  daysInPeriod: number;
  expiresAt: Date;
}

export function serializePreview(preview: PreviewView): Record<string, unknown> {
  return {
    previewId: preview.id,
    fromTier: preview.fromTier,
    toTier: preview.toTier,
    currency: preview.currency,
    credit: toAmountString(preview.credit),
    charge: toAmountString(preview.charge),
    total: toAmountString(preview.total),
    creditShare: sharePercent(
      absMoney(preview.credit).minor,
      absMoney(preview.credit).minor + preview.charge.minor,
    ),
    daysLeft: preview.daysLeft,
    daysInPeriod: preview.daysInPeriod,
    expiresAt: studioInstant(preview.expiresAt),
  };
}

async function newTierPrice(toTier: CareTier, currency: Currency): Promise<Money> {
  const row = await priceInEffect(carePlanId(toTier), currency, new Date());
  if (!row) throw errors.billingUnavailable();
  return row.amount;
}

export async function createPreview(input: {
  accountId: string;
  killbillAccountId: string;
  plan: PlanView;
  toTier: CareTier;
}): Promise<PreviewView> {
  const price = await newTierPrice(input.toTier, input.plan.currency);
  const proration = await killbill.dryRunChange({
    accountId: input.killbillAccountId,
    bundleId: input.plan.bundleId,
    subscriptionId: input.plan.subscriptionId,
    tier: input.toTier,
    price,
  });
  const today = studioDate(new Date());
  const periodStart = proration.periodStart ?? input.plan.periodStart ?? today;
  const periodEnd = proration.periodEnd ?? input.plan.chargedThrough ?? addDaysToDate(today, 30);
  const daysInPeriod = Math.max(1, daysBetween(periodStart, periodEnd));
  const daysLeft = Math.max(0, daysBetween(today, periodEnd));
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + config.durations.previewTtlSeconds * 1000);
  await query(
    `insert into plan_previews (id, account_id, order_id, from_tier, to_tier, currency, credit_minor,
       charge_minor, total_minor, days_left, days_in_period, business_date, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      input.accountId,
      input.plan.orderId,
      input.plan.tier,
      input.toTier,
      input.plan.currency,
      proration.credit.minor.toString(),
      proration.charge.minor.toString(),
      proration.total.minor.toString(),
      daysLeft,
      daysInPeriod,
      today,
      expiresAt.toISOString(),
    ],
  );
  return {
    id,
    fromTier: input.plan.tier,
    toTier: input.toTier,
    currency: input.plan.currency,
    credit: proration.credit,
    charge: proration.charge,
    total: proration.total,
    daysLeft,
    daysInPeriod,
    expiresAt,
  };
}

export interface StoredPreview extends PreviewView {
  orderId: string;
  accountId: string;
  usedAt: Date | null;
}

export async function storedPreview(id: string, accountId: string): Promise<StoredPreview | null> {
  const record = await queryOne<{
    id: string;
    account_id: string;
    order_id: string;
    from_tier: string;
    to_tier: string;
    currency: string;
    credit_minor: string;
    charge_minor: string;
    total_minor: string;
    days_left: number;
    days_in_period: number;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `select id, account_id, order_id, from_tier, to_tier, currency, credit_minor, charge_minor, total_minor,
            days_left, days_in_period, expires_at, used_at
       from plan_previews where id = $1 and account_id = $2`,
    [id, accountId],
  );
  if (!record) return null;
  const currency = record.currency as Currency;
  return {
    id: record.id,
    accountId: record.account_id,
    orderId: record.order_id,
    fromTier: record.from_tier as CareTier,
    toTier: record.to_tier as CareTier,
    currency,
    credit: money(currency, BigInt(record.credit_minor)),
    charge: money(currency, BigInt(record.charge_minor)),
    total: money(currency, BigInt(record.total_minor)),
    daysLeft: record.days_left,
    daysInPeriod: record.days_in_period,
    expiresAt: record.expires_at,
    usedAt: record.used_at,
  };
}

export async function markPreviewUsed(id: string): Promise<void> {
  await query(`update plan_previews set used_at = now() where id = $1`, [id]);
}

export async function relockCarePrice(orderId: string, tier: CareTier, price: Money): Promise<void> {
  await query(
    `update orders set care_tier = $2, plan = $3, total_minor = $4, deposit_minor = $4 where id = $1`,
    [orderId, tier, carePlanId(tier), price.minor.toString()],
  );
}

export { newTierPrice };
