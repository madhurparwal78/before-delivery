import type { Db } from './db.js';
import type { Amount, Currency } from './money.js';
import { amountFromMinor, amountToString, sharePercent } from './money.js';
import {
  cancelSubscriptionEndOfTerm,
  cancelSubscriptionNow,
  changeSubscription,
  getBundleEvents,
  getSubscription,
  pauseBundle,
  resumeBundle,
  type KbInvoice,
  type KbSubscription,
} from './killbill.js';
import {
  BillingUnavailable,
  chargeInvoice,
  ensureBillingReachable,
  ensureKillbillAccount,
  findChangeInvoice,
  invoiceAmounts,
  listAccountInvoicesSafe,
  openAmountOf,
  orderReceiptPath,
  queueEmail,
  receiptEmail,
  recordInvoice,
  type ChargeContext,
} from './billing.js';
import { cardDecision, declineError } from './cards.js';
import { type CareTier, type PlanStatus } from './domain.js';
import { newId, HttpError, config, baDate } from './util.js';
import type { OrderRow } from './orders.js';

export interface PlanView {
  id: string;
  tier: CareTier;
  planName: string;
  status: PlanStatus;
  currency: Currency;
  monthlyPrice: string;
  periodStart: string | null;
  chargedThrough: string | null;
  pauseOn: string | null;
  endsOn: string | null;
  failedAttempts: number;
  nextRetryAt: string | null;
}

export interface OpenRenewal {
  invoiceId: string;
  amount: Amount;
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y!, (m! - 1) + months, 1));
  const targetMonthDays = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d!, targetMonthDays);
  const result = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day));
  return result.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The one place that computes a care tier change proration: whole Buenos Aires
 * days left in the period, credit for the current tier, charge for the new tier,
 * each rounded half-up to the cent.
 */
export function proration(input: {
  currentPrice: Amount;
  newPrice: Amount;
  periodStart: string;
  chargedThrough: string;
  today: string;
}): { credit: Amount; charge: Amount; total: Amount; daysLeft: number; daysInPeriod: number } {
  const daysInPeriod = Math.max(daysBetween(input.periodStart, input.chargedThrough), 1);
  const daysLeft = Math.max(daysBetween(input.today, input.chargedThrough), 0);
  const creditMinor = -roundHalfUp(input.currentPrice.minor * BigInt(daysLeft) * 100n, BigInt(daysInPeriod) * 100n);
  const chargeMinor = roundHalfUp(input.newPrice.minor * BigInt(daysLeft) * 100n, BigInt(daysInPeriod) * 100n);
  const credit = amountFromMinor(input.currentPrice.currency, creditMinor);
  const charge = amountFromMinor(input.newPrice.currency, chargeMinor);
  return { credit, charge, total: amountFromMinor(credit.currency, credit.minor + charge.minor), daysLeft, daysInPeriod };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

export async function findCareOrder(db: Db, accountId: string): Promise<OrderRow | null> {
  const { getOrder } = await import('./orders.js');
  const result = await db.query(
    "SELECT id FROM orders WHERE account_id = $1 AND plan IN ('care-lite', 'care-plus') ORDER BY created_at DESC LIMIT 1",
    [accountId],
  );
  const row = result.rows[0] as { id: string } | undefined;
  if (!row) return null;
  return await getOrder(db, row.id);
}

function planInvalidTransition(status: PlanStatus): HttpError {
  return new HttpError(409, 'invalid_transition', `This plan is ${status.replace(/_/g, ' ')} and cannot do that right now.`);
}

export interface PlanState {
  order: OrderRow;
  subscription: KbSubscription;
  killbillAccountId: string;
  pauseOn: string | null;
  openRenewal: OpenRenewal | null;
  failedAttempts: number;
  nextRetryAt: Date | null;
}

export async function loadPlanState(db: Db, accountId: string): Promise<PlanState | null> {
  const order = await findCareOrder(db, accountId);
  if (!order || !order.killbillSubscriptionId) return null;
  const { getAccount } = await import('./auth.js');
  const account = await getAccount(db, accountId);
  if (!account) return null;
  const killbillAccountId =
    account.killbillAccountId ?? (await ensureKillbillAccount(db, accountId, account.businessName, '', account.currency));
  const subscription = await getSubscription(order.killbillSubscriptionId).catch(() => {
    throw new BillingUnavailable();
  });
  const events = await getBundleEvents(subscription.bundleId).catch(() => {
    throw new BillingUnavailable();
  });
  let pauseOn: string | null = null;
  const pauseEvents = events.filter((e) => e.eventType === 'PAUSE_ENTITLEMENT');
  const resumeEvents = events.filter((e) => e.eventType === 'RESUME_ENTITLEMENT');
  for (const pause of pauseEvents) {
    const cancelled = resumeEvents.some((r) => r.effectiveDate >= pause.effectiveDate);
    if (!cancelled && pause.effectiveDate.slice(0, 10) > baDate(new Date())) {
      pauseOn = pause.effectiveDate.slice(0, 10);
    }
  }
  const invoices = await listAccountInvoicesSafe(killbillAccountId);
  const careInvoices = invoices.filter((inv) => inv.items.some((item) => item.subscriptionId === subscription.subscriptionId));
  const known = await db.query('SELECT invoice_id, kind FROM invoice_records WHERE order_id = $1', [order.id]);
  const knownIds = new Map((known.rows as { invoice_id: string; kind: string }[]).map((r) => [r.invoice_id, r.kind]));
  let openRenewal: OpenRenewal | null = null;
  for (const inv of careInvoices) {
    if (knownIds.get(inv.invoiceId) === 'care') continue;
    if (inv.items.some((item) => item.itemType === 'REPAIR_ADJ')) continue;
    const open = openAmountOf(inv);
    if (open) {
      openRenewal = { invoiceId: inv.invoiceId, amount: open };
      break;
    }
  }
  const attempts = await db.query(
    'SELECT attempt_no, attempted_at, due_at, succeeded FROM dunning_attempts WHERE order_id = $1 ORDER BY attempt_no DESC LIMIT 1',
    [order.id],
  );
  const lastAttempt = attempts.rows[0] as { attempt_no: number; attempted_at: Date | null; due_at: Date; succeeded: boolean } | undefined;
  const failedAttempts = lastAttempt?.succeeded === false ? lastAttempt.attempt_no : 0;
  const pending = await db.query(
    'SELECT due_at FROM dunning_attempts WHERE order_id = $1 AND attempted_at IS NULL ORDER BY attempt_no ASC LIMIT 1',
    [order.id],
  );
  const pendingRow = pending.rows[0] as { due_at: Date } | undefined;
  return {
    order,
    subscription,
    killbillAccountId,
    pauseOn,
    openRenewal,
    failedAttempts,
    nextRetryAt: pendingRow ? new Date(pendingRow.due_at) : null,
  };
}

export function planStatus(state: PlanState): PlanStatus {
  const sub = state.subscription;
  if (sub.state === 'CANCELLED') return 'cancelled';
  if (sub.cancelledDate && sub.cancelledDate.slice(0, 10) > baDate(new Date())) return 'pending_cancel';
  if (state.openRenewal && state.failedAttempts > 0) return 'past_due';
  if (sub.state === 'BLOCKED') return 'paused';
  return 'active';
}

export function planView(state: PlanState): PlanView {
  const tier: CareTier = state.subscription.productName === 'care-plus' ? 'plus' : 'lite';
  const price = currentSubscriptionPrice(state.subscription, state.order.currency);
  const chargedThrough = state.subscription.chargedThroughDate?.slice(0, 10) ?? null;
  const periodStart = chargedThrough ? addMonths(chargedThrough, -1) : null;
  const status = planStatus(state);
  return {
    id: state.order.id,
    tier,
    planName: tier === 'lite' ? 'Care Lite' : 'Care Plus',
    status,
    currency: state.order.currency,
    monthlyPrice: amountToString(price ?? amountFromMinor(state.order.currency, BigInt(state.order.total_minor))),
    periodStart,
    chargedThrough,
    pauseOn: state.pauseOn,
    endsOn: status === 'pending_cancel' ? (state.subscription.cancelledDate?.slice(0, 10) ?? null) : null,
    failedAttempts: state.failedAttempts,
    nextRetryAt: state.nextRetryAt ? state.nextRetryAt.toISOString() : null,
  };
}

export function currentSubscriptionPrice(subscription: KbSubscription, currency: Currency): Amount | null {
  const price = subscription.prices.at(-1)?.recurringPrice;
  if (price === null || price === undefined) return null;
  return amountFromMinor(currency, BigInt(Math.round(price * 100)));
}

export interface PreviewResult {
  previewId: string;
  fromTier: CareTier;
  toTier: CareTier;
  currency: Currency;
  credit: Amount;
  charge: Amount;
  total: Amount;
  creditShare: string;
  daysLeft: number;
  daysInPeriod: number;
  expiresAt: Date;
}

export async function createPreview(db: Db, state: PlanState, toTier: CareTier): Promise<PreviewResult> {
  const fromTier: CareTier = state.order.plan === 'care-lite' ? 'lite' : 'plus';
  if (fromTier === toTier) {
    throw new HttpError(422, 'same_tier', 'Your plan is already that tier.', { tier: 'Your plan is already that tier.' });
  }
  const { priceInEffect } = await import('./pricing.js');
  const { planCarePlanId } = await import('./domain.js');
  const currentPrice = currentSubscriptionPrice(state.subscription, state.order.currency) ?? amountFromMinor(state.order.currency, BigInt(state.order.total_minor));
  const newPlan = planCarePlanId(toTier);
  const priceRow = await priceInEffect(db, newPlan, state.order.currency, new Date());
  if (!priceRow) throw new BillingUnavailable();
  const chargedThrough = state.subscription.chargedThroughDate?.slice(0, 10);
  if (!chargedThrough) throw new BillingUnavailable();
  const periodStart = addMonths(chargedThrough, -1);
  const figures = proration({
    currentPrice,
    newPrice: priceRow.amount,
    periodStart,
    chargedThrough,
    today: baDate(new Date()),
  });
  const previewId = newId();
  const expiresAt = new Date(Date.now() + config.previewTtlSeconds * 1000);
  await db.query(
    `INSERT INTO previews (id, account_id, from_tier, to_tier, currency, credit_minor, charge_minor, total_minor, credit_share, days_left, days_in_period, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
    [
      previewId,
      state.order.accountId!,
      fromTier,
      toTier,
      figures.credit.currency,
      figures.credit.minor,
      figures.charge.minor,
      figures.total.minor,
      sharePercent(-figures.credit.minor, -figures.credit.minor + figures.charge.minor),
      figures.daysLeft,
      figures.daysInPeriod,
      expiresAt.toISOString(),
    ],
  );
  return {
    previewId,
    fromTier,
    toTier,
    currency: figures.credit.currency,
    credit: figures.credit,
    charge: figures.charge,
    total: figures.total,
    creditShare: sharePercent(-figures.credit.minor, -figures.credit.minor + figures.charge.minor),
    daysLeft: figures.daysLeft,
    daysInPeriod: figures.daysInPeriod,
    expiresAt,
  };
}

export function previewToJson(preview: PreviewResult): Record<string, unknown> {
  return {
    previewId: preview.previewId,
    fromTier: preview.fromTier,
    toTier: preview.toTier,
    currency: preview.currency,
    credit: amountToString(preview.credit),
    charge: amountToString(preview.charge),
    total: amountToString(preview.total),
    creditShare: preview.creditShare,
    daysLeft: preview.daysLeft,
    daysInPeriod: preview.daysInPeriod,
    expiresAt: preview.expiresAt.toISOString(),
  };
}

export interface ChangeResult {
  plan: PlanView;
  invoice: Record<string, unknown>;
}

export async function confirmChange(db: Db, accountId: string, previewId: string): Promise<ChangeResult> {
  const result = await db.query('SELECT * FROM previews WHERE id = $1 AND account_id = $2', [previewId, accountId]);
  if (result.rowCount === 0) throw new HttpError(404, 'not_found', 'We could not find that.');
  const row = result.rows[0] as {
    from_tier: CareTier;
    to_tier: CareTier;
    currency: Currency;
    credit_minor: string;
    charge_minor: string;
    total_minor: string;
    credit_share: string;
    days_left: number;
    days_in_period: number;
    expires_at: Date;
  };
  if (new Date(row.expires_at) < new Date()) {
    throw new HttpError(409, 'preview_expired', 'This preview expired. Open the change again for fresh figures.');
  }
  const state = await loadPlanState(db, accountId);
  if (!state) throw new HttpError(404, 'not_found', 'We could not find that.');
  const fresh = await createPreviewFigures(db, state, row.to_tier);
  const stored = {
    credit: amountFromMinor(row.currency, BigInt(row.credit_minor)),
    charge: amountFromMinor(row.currency, BigInt(row.charge_minor)),
    total: amountFromMinor(row.currency, BigInt(row.total_minor)),
    daysLeft: row.days_left,
    daysInPeriod: row.days_in_period,
  };
  if (
    fresh.credit.minor !== stored.credit.minor ||
    fresh.charge.minor !== stored.charge.minor ||
    fresh.daysLeft !== stored.daysLeft ||
    fresh.daysInPeriod !== stored.daysInPeriod
  ) {
    const preview = await createPreview(db, state, row.to_tier);
    throw new HttpError(409, 'preview_stale', 'Billing moved on since your preview. Review the updated figures.', undefined, {
      preview: previewToJson(preview),
    });
  }
  const status = planStatus(state);
  if (status !== 'active' || state.pauseOn) {
    throw planInvalidTransition(status);
  }
  await ensureBillingReachable();
  const account = (await import('./auth.js')).getAccount;
  const acct = await account(db, accountId);
  if (!acct || !acct.killbillAccountId) throw new HttpError(409, 'no_billing_account', 'This account has no billing account yet.');
  const ownerEmail = await accountOwnerEmail(db, accountId);
  const killbillAccountId = await ensureKillbillAccount(db, accountId, acct.businessName, ownerEmail, acct.currency);

  if (stored.total.minor > 0n) {
    const decision = cardDecision(acct.cardLast4 ?? '');
    if (decision === 'decline') throw declineError();
  }

  const toPlanId = row.to_tier === 'lite' ? 'care-lite-monthly' : 'care-plus-monthly';
  const newPrice = fresh.newPrice;
  const changedAt = new Date();
  await changeSubscription(state.subscription.subscriptionId, killbillAccountId, toPlanId, newPrice);

  // Wait for billing to hold the change invoice, then read its figures.
  let changeInvoice = null as Awaited<ReturnType<typeof findChangeInvoice>>;
  for (let i = 0; i < 40; i++) {
    changeInvoice = await findChangeInvoice(killbillAccountId, state.subscription.subscriptionId, changedAt);
    if (changeInvoice) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!changeInvoice) throw new BillingUnavailable();

  const amounts = invoiceAmounts(changeInvoice);
  if (stored.total.minor > 0n) {
    const chargeCtx: ChargeContext = { accountId, killbillAccountId, currency: acct.currency, cardLast4: acct.cardLast4 ?? '' };
    await chargeInvoice(chargeCtx, changeInvoice.invoiceId, amounts.balance, `${previewId}-change`);
    const email = receiptEmail(state.order.number, 'change', amounts.balance, orderReceiptPath(state.order.id));
    await queueEmail(db, { ...email, to: ownerEmail });
  }
  await recordInvoice(db, { invoiceId: changeInvoice.invoiceId, accountId, orderId: state.order.id, kind: 'change' });
  const newState = await loadPlanState(db, accountId);
  const view = newState ? planView(newState) : planView(state);
  return { plan: view, invoice: invoiceRecordToJson(changeInvoice, 'change', state.order.id) };
}

async function createPreviewFigures(db: Db, state: PlanState, toTier: CareTier): Promise<{ credit: Amount; charge: Amount; total: Amount; daysLeft: number; daysInPeriod: number; newPrice: Amount }> {
  const { priceInEffect } = await import('./pricing.js');
  const { planCarePlanId } = await import('./domain.js');
  const currentPrice = currentSubscriptionPrice(state.subscription, state.order.currency) ?? amountFromMinor(state.order.currency, BigInt(state.order.total_minor));
  const priceRow = await priceInEffect(db, planCarePlanId(toTier), state.order.currency, new Date());
  if (!priceRow) throw new BillingUnavailable();
  const chargedThrough = state.subscription.chargedThroughDate?.slice(0, 10);
  if (!chargedThrough) throw new BillingUnavailable();
  const figures = proration({
    currentPrice,
    newPrice: priceRow.amount,
    periodStart: addMonths(chargedThrough, -1),
    chargedThrough,
    today: baDate(new Date()),
  });
  return { ...figures, newPrice: priceRow.amount };
}

async function accountOwnerEmail(db: Db, accountId: string): Promise<string> {
  const result = await db.query("SELECT email FROM users WHERE account_id = $1 AND role = 'client_owner' LIMIT 1", [accountId]);
  const row = result.rows[0] as { email: string } | undefined;
  return row?.email ?? 'client@pampero.test';
}

export function invoiceRecordToJson(invoice: KbInvoice, kind: string, orderId: string): Record<string, unknown> {
  let status: 'paid' | 'open' | 'void' | 'credit' = 'open';
  if (invoice.status === 'VOID' || invoice.status === 'VOIDED') status = 'void';
  else if (invoice.amount < 0) status = 'credit';
  else if (Math.abs(invoice.balance) < 0.005) status = 'paid';
  const description = invoice.items[0]?.description ?? 'Care plan';
  const amount = invoiceAmounts(invoice);
  return {
    id: invoice.invoiceId,
    number: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    kind,
    description,
    amount: amountToString(amount.amount),
    balance: amountToString(amount.balance),
    currency: invoice.currency,
    status,
    orderId,
    pdf: false,
  };
}

export async function pausePlan(db: Db, state: PlanState): Promise<PlanView> {
  if (planStatus(state) !== 'active' || state.pauseOn) throw planInvalidTransition(planStatus(state));
  const chargedThrough = state.subscription.chargedThroughDate?.slice(0, 10);
  if (!chargedThrough) throw new BillingUnavailable();
  await pauseBundle(state.subscription.bundleId, chargedThrough);
  return planView(await requireFreshState(db, state.order.accountId!));
}

export async function resumePlan(db: Db, state: PlanState): Promise<PlanView> {
  const status = planStatus(state);
  if (status === 'active' && state.pauseOn) {
    // dropping a scheduled pause: the resume lands on the pause's own date
    await resumeBundle(state.subscription.bundleId, state.pauseOn);
    return planView(await requireFreshState(db, state.order.accountId!));
  }
  if (status !== 'paused') throw planInvalidTransition(planStatus(state));
  const account = (await import('./auth.js')).getAccount;
  const acct = await account(db, state.order.accountId!);
  if (!acct) throw new HttpError(404, 'not_found', 'We could not find that.');
  const today = baDate(new Date());
  await resumeBundle(state.subscription.bundleId, today);
  // billing restarts today; the invoice it raises is paid with the account's card
  const decision = cardDecision(acct.cardLast4 ?? '');
  if (decision === 'decline') throw declineError();
  for (let i = 0; i < 60; i++) {
    const newState = await requireFreshState(db, state.order.accountId!);
    if (newState.openRenewal) {
      // claim the invoice before charging so the dunning worker never double-handles it
      await recordInvoice(db, { invoiceId: newState.openRenewal.invoiceId, accountId: state.order.accountId!, orderId: state.order.id, kind: 'renewal' });
      const { sendInvoiceNotice } = await import('./dunning.js');
      const ownerEmail = await accountOwnerEmail(db, state.order.accountId!);
      const { invoiceHasBeenNoticed, markInvoiceNoticed } = await import('./billing.js');
      if (!(await invoiceHasBeenNoticed(db, newState.openRenewal.invoiceId))) {
        await markInvoiceNoticed(db, newState.openRenewal.invoiceId);
        await sendInvoiceNotice(db, state.order.accountId!, newState.openRenewal.amount, '');
      }
      const chargeCtx: ChargeContext = { accountId: state.order.accountId!, killbillAccountId: state.killbillAccountId, currency: acct.currency, cardLast4: acct.cardLast4 ?? '' };
      await chargeInvoice(chargeCtx, newState.openRenewal.invoiceId, newState.openRenewal.amount, `${newState.openRenewal.invoiceId}-renewal`);
      const email = receiptEmail(state.order.number, 'renewal', newState.openRenewal.amount, orderReceiptPath(state.order.id));
      await queueEmail(db, { ...email, to: ownerEmail });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return planView(await requireFreshState(db, state.order.accountId!));
}

export async function cancelPlan(db: Db, state: PlanState): Promise<PlanView> {
  if (planStatus(state) !== 'active' || state.pauseOn) throw planInvalidTransition(planStatus(state));
  const chargedThrough = state.subscription.chargedThroughDate?.slice(0, 10);
  if (!chargedThrough) throw new BillingUnavailable();
  await cancelSubscriptionEndOfTerm(state.subscription.subscriptionId, baDate(new Date()));
  return planView(await requireFreshState(db, state.order.accountId!));
}

export async function cancelPlanNow(_db: Db, state: PlanState): Promise<void> {
  await cancelSubscriptionNow(state.subscription.subscriptionId);
}

async function requireFreshState(db: Db, accountId: string): Promise<PlanState> {
  const state = await loadPlanState(db, accountId);
  if (!state) throw new HttpError(404, 'not_found', 'We could not find that.');
  return state;
}
