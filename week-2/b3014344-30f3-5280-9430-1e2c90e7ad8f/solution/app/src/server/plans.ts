import { randomUUID } from "node:crypto";
import { approves, declined, readCard } from "./cards";
import { SEED_PRICES } from "./catalog";
import { config } from "./config";
import { query, rows, tx, type Db, type Row } from "./db";
import { errors, HttpError, isUuid, record } from "./http";
import * as billing from "./killbill";
import { enqueue, messages } from "./mail";
import { invoiceBody } from "./invoices";
import { accountWithOwner, settle, type Settlement } from "./orders";
import { priceAt } from "./pricing";
import { daysBetween, studioDate, studioInstant } from "./time";
import { COPY } from "../shared/copy";
import { carePlan, PLAN_NAMES, type Plan, type PlanStatus, type Preview, type Tier } from "../shared/domain";
import { sharePercent, toAmount, type Currency } from "../shared/money";

interface PlanRow extends Row {
  id: string;
  order_id: string;
  order_number: string;
  account_id: string;
  tier: Tier;
  monthly_minor: string;
  kb_bundle_id: string;
  kb_subscription_id: string;
  currency: Currency;
  kb_account_id: string;
  card_last4: string | null;
}

const PLAN_SELECT = `SELECT cp.*, o.number AS order_number, a.currency, a.kb_account_id, a.card_last4
  FROM care_plans cp JOIN orders o ON o.id = cp.order_id JOIN client_accounts a ON a.id = cp.account_id`;

/** The account's care plan: at most one that is not cancelled, else its latest. */
async function planFor(accountId: string, db?: Db): Promise<PlanRow | undefined> {
  const sql = `${PLAN_SELECT} WHERE cp.account_id = $1 ORDER BY cp.created_at DESC LIMIT 1`;
  return db ? (await rows<PlanRow>(db, sql, [accountId]))[0] : (await query<PlanRow>(sql, [accountId]))[0];
}

/** Holds the plan's row lock for an action, so actions, renewals and dunning never interleave. */
async function withPlanLock<T>(accountId: string, work: (db: Db, plan: PlanRow) => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await db.query("SET LOCAL lock_timeout = '15s'");
    const plan = await planFor(accountId, db);
    if (!plan) throw errors.notFound();
    await db.query("SELECT 1 FROM care_plans WHERE id = $1 FOR UPDATE", [plan.id]);
    return work(db, plan);
  });
}

// ---- reading the plan from Kill Bill

interface BillingView {
  plan: Plan;
  subscription: billing.KbSubscription;
  invoices: billing.KbInvoice[];
  pausedNow: boolean;
  scheduledPause: string | null;
}

function pauseState(bundle: billing.KbBundle, now: Date): { pausedNow: boolean; scheduledPause: string | null; pausedFrom: string | null } {
  const events = bundle.timeline.events.filter((e) => e.eventType === "PAUSE_ENTITLEMENT" || e.eventType === "RESUME_ENTITLEMENT");
  let pausedNow = false;
  let pausedFrom: string | null = null;
  for (const event of events) {
    if (Date.parse(event.effectiveDate) <= now.getTime()) {
      pausedNow = event.eventType === "PAUSE_ENTITLEMENT";
      pausedFrom = pausedNow ? studioDate(new Date(event.effectiveDate)) : null;
    }
  }
  const last = events[events.length - 1];
  const scheduledPause =
    last && last.eventType === "PAUSE_ENTITLEMENT" && Date.parse(last.effectiveDate) > now.getTime() ? studioDate(new Date(last.effectiveDate)) : null;
  return { pausedNow, scheduledPause, pausedFrom };
}

function recurringItems(invoices: billing.KbInvoice[], subscriptionId: string): billing.KbItem[] {
  return invoices
    .filter((inv) => inv.status !== "VOID")
    .flatMap((inv) => inv.items)
    .filter((item) => item.subscriptionId === subscriptionId && item.itemType === "RECURRING" && item.startDate && item.endDate);
}

/** The start of the period that runs to the charged-through date, as Kill Bill invoiced it. */
function periodStartOf(items: billing.KbItem[], chargedThrough: string | null): string | null {
  const ending = items.filter((item) => item.endDate === chargedThrough).map((item) => item.startDate!);
  const pool = ending.length ? ending : items.map((item) => item.startDate!);
  return pool.length ? pool.reduce((a, b) => (ending.length ? (a < b ? a : b) : a > b ? a : b)) : null;
}

function openRenewal(view: { invoices: billing.KbInvoice[] }, plan: PlanRow, paidInvoices: Set<string>): billing.KbInvoice | undefined {
  return view.invoices.find(
    (inv) =>
      inv.status === "COMMITTED" &&
      billing.kbMinor(inv.balance) > 0n &&
      !paidInvoices.has(inv.invoiceId) &&
      !inv.items.some((item) => item.itemType === "REPAIR_ADJ") &&
      inv.items.some((item) => item.subscriptionId === plan.kb_subscription_id && item.itemType === "RECURRING"),
  );
}

/** The plan as Kill Bill holds it at `now`; after an action, `now` is read once Kill Bill has confirmed it. */
async function readPlan(plan: PlanRow, now: Date, db?: Db): Promise<BillingView> {
  const [bundle, invoices, failedAttempts] = await Promise.all([
    billing.bundle(plan.kb_bundle_id),
    billing.accountInvoices(plan.kb_account_id),
    billing.failedAttempts(plan.kb_subscription_id),
  ]);
  const subscription = bundle.subscriptions.find((s) => s.subscriptionId === plan.kb_subscription_id) ?? bundle.subscriptions[0];
  if (!subscription) throw errors.billing();
  const { pausedNow, scheduledPause, pausedFrom } = pauseState(bundle, now);
  const sql = "SELECT next_attempt_at FROM renewals WHERE plan_id = $1 AND settled_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT 1";
  const [retry] = db ? await rows<{ next_attempt_at: Date | null }>(db, sql, [plan.id]) : await query<{ next_attempt_at: Date | null }>(sql, [plan.id]);
  const paid = await paidInvoiceIds(plan, db);
  let status: PlanStatus = "active";
  if (subscription.state === "CANCELLED" || subscription.state === "EXPIRED") status = "cancelled";
  else if (pausedNow || subscription.state === "BLOCKED") status = "paused";
  else if (failedAttempts > 0 && openRenewal({ invoices }, plan, paid)) status = "past_due";
  else if (subscription.billingEndDate) status = "pending_cancel";
  const items = recurringItems(invoices, subscription.subscriptionId);
  const tier: Tier = subscription.productName === "care-plus" ? "plus" : "lite";
  const body: Plan = {
    id: plan.id,
    tier,
    planName: PLAN_NAMES[carePlan(tier)],
    status,
    currency: plan.currency,
    monthlyPrice: toAmount(BigInt(plan.monthly_minor)),
    periodStart: periodStartOf(items, subscription.chargedThroughDate),
    chargedThrough: subscription.chargedThroughDate,
    pauseOn: status === "paused" ? pausedFrom : status === "active" ? scheduledPause : null,
    endsOn:
      status === "pending_cancel"
        ? subscription.chargedThroughDate
        : status === "cancelled" && subscription.cancelledDate
          ? studioDate(new Date(subscription.cancelledDate))
          : null,
    failedAttempts,
    nextRetryAt: status === "past_due" && retry?.next_attempt_at ? studioInstant(retry.next_attempt_at) : null,
  };
  return { plan: body, subscription, invoices, pausedNow, scheduledPause };
}

async function paidInvoiceIds(plan: PlanRow, db?: Db): Promise<Set<string>> {
  const sql = "SELECT kb_invoice_id FROM payments WHERE order_id = $1";
  const found = db ? await rows<{ kb_invoice_id: string }>(db, sql, [plan.order_id]) : await query<{ kb_invoice_id: string }>(sql, [plan.order_id]);
  return new Set(found.map((r) => r.kb_invoice_id));
}

function noPlan(): HttpError {
  return new HttpError(404, "not_found", "This account has no care plan.");
}

export async function currentPlan(accountId: string, now: Date): Promise<Plan> {
  const plan = await planFor(accountId);
  if (!plan) throw noPlan();
  return (await readPlan(plan, now)).plan;
}

function requireActive(view: BillingView, allowPendingCancel = false): void {
  const { status, pauseOn } = view.plan;
  if (status !== "active" && !(allowPendingCancel && status === "pending_cancel")) throw errors.invalidTransition(status.replace("_", " "));
  if (pauseOn) throw errors.invalidTransition("set to pause");
}

// ---- previews and changes

function overridesFor(tier: Tier, currency: Currency, monthly: bigint): billing.PriceOverride[] | undefined {
  const plan = carePlan(tier);
  return billing.careOverride(`${plan}-monthly`, SEED_PRICES[plan][currency], monthly);
}

interface Proration {
  monthly: bigint;
  credit: bigint;
  charge: bigint;
  daysLeft: number;
  daysInPeriod: number;
}

async function prorate(plan: PlanRow, view: BillingView, toTier: Tier, now: Date): Promise<Proration> {
  const monthly = (await priceAt(carePlan(toTier), plan.currency, now)).amountMinor;
  const dry = await billing.dryRunChange({
    accountId: plan.kb_account_id,
    bundleId: plan.kb_bundle_id,
    subscriptionId: plan.kb_subscription_id,
    productName: carePlan(toTier),
    overrides: overridesFor(toTier, plan.currency, monthly),
  });
  const items = dry?.items ?? [];
  const credit = items.filter((i) => i.itemType === "REPAIR_ADJ").reduce((sum, i) => sum + billing.kbMinor(i.amount), 0n);
  const recurring = items.filter((i) => i.itemType === "RECURRING");
  const charge = recurring.reduce((sum, i) => sum + billing.kbMinor(i.amount), 0n);
  const first = recurring[0];
  const daysLeft = first?.startDate && first.endDate ? daysBetween(first.startDate, first.endDate) : 0;
  const start = view.plan.periodStart;
  const end = view.plan.chargedThrough;
  const daysInPeriod = start && end ? daysBetween(start, end) : daysLeft;
  return { monthly, credit, charge, daysLeft, daysInPeriod };
}

interface PreviewRow extends Row {
  id: string;
  plan_id: string;
  from_tier: Tier;
  to_tier: Tier;
  currency: Currency;
  monthly_minor: string;
  credit_minor: string;
  charge_minor: string;
  days_left: number;
  days_in_period: number;
  expires_at: Date;
}

function previewBody(row: PreviewRow): Preview {
  const credit = BigInt(row.credit_minor);
  const charge = BigInt(row.charge_minor);
  const magnitude = credit < 0n ? -credit : credit;
  return {
    previewId: row.id,
    fromTier: row.from_tier,
    toTier: row.to_tier,
    currency: row.currency,
    credit: toAmount(credit),
    charge: toAmount(charge),
    total: toAmount(credit + charge),
    creditShare: sharePercent(magnitude, magnitude + charge),
    daysLeft: row.days_left,
    daysInPeriod: row.days_in_period,
    expiresAt: studioInstant(row.expires_at),
  };
}

async function storePreview(db: Db | null, plan: PlanRow, fromTier: Tier, toTier: Tier, p: Proration, now: Date): Promise<Preview> {
  const sql = `INSERT INTO previews (id, plan_id, from_tier, to_tier, currency, monthly_minor, credit_minor, charge_minor, days_left, days_in_period, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`;
  const params = [
    randomUUID(),
    plan.id,
    fromTier,
    toTier,
    plan.currency,
    p.monthly.toString(),
    p.credit.toString(),
    p.charge.toString(),
    p.daysLeft,
    p.daysInPeriod,
    new Date(now.getTime() + config.previewTtlSeconds * 1000),
  ];
  const [row] = db ? await rows<PreviewRow>(db, sql, params) : await query<PreviewRow>(sql, params);
  return previewBody(row!);
}

function readTier(body: unknown): Tier {
  const tier = record(body).tier;
  if (tier !== "lite" && tier !== "plus") throw errors.invalid({ tier: "Choose lite or plus." });
  return tier;
}

export async function preview(accountId: string, body: unknown, now: Date): Promise<Preview> {
  const plan = await planFor(accountId);
  if (!plan) throw noPlan();
  const view = await readPlan(plan, now);
  requireActive(view);
  const toTier = readTier(body);
  if (toTier === view.plan.tier) throw errors.invalid({ tier: `Your plan is already ${view.plan.planName}.` });
  return storePreview(null, plan, view.plan.tier, toTier, await prorate(plan, view, toTier, now), now);
}

/** Finds the invoice Kill Bill raised for a change: the new one carrying a repair adjustment. */
async function changeInvoice(plan: PlanRow, before: Set<string>): Promise<billing.KbInvoice> {
  for (let tries = 0; tries < 40; tries++) {
    const found = (await billing.accountInvoices(plan.kb_account_id)).find(
      (inv) => !before.has(inv.invoiceId) && inv.items.some((item) => item.itemType === "REPAIR_ADJ"),
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw errors.billing();
}

export async function confirmChange(accountId: string, body: unknown, now: Date) {
  const previewId = record(body).previewId;
  return withPlanLock(accountId, async (db, plan) => {
    const [stored] =
      isUuid(previewId)
        ? await rows<PreviewRow>(db, "SELECT * FROM previews WHERE id = $1 AND plan_id = $2", [previewId, plan.id])
        : [];
    if (!stored) throw errors.notFound();
    if (stored.expires_at.getTime() <= now.getTime()) throw new HttpError(409, "preview_expired", COPY.previewExpired);
    const view = await readPlan(plan, now, db);
    requireActive(view);
    if (view.plan.tier !== stored.from_tier) throw errors.invalidTransition(`already ${view.plan.planName}`);
    const fresh = await prorate(plan, view, stored.to_tier, now);
    if (fresh.credit !== BigInt(stored.credit_minor) || fresh.charge !== BigInt(stored.charge_minor) || fresh.monthly !== BigInt(stored.monthly_minor)) {
      const updated = await storePreview(db, plan, view.plan.tier, stored.to_tier, fresh, now);
      throw new HttpError(409, "preview_stale", COPY.previewStale, undefined, { preview: updated });
    }
    const total = fresh.credit + fresh.charge;
    if (total > 0n && !approves(plan.card_last4)) throw declined();
    const before = new Set(view.invoices.map((inv) => inv.invoiceId));
    const paymentIds = total > 0n ? await billing.authorize(plan.kb_account_id, total, plan.currency, `${stored.id}-change`) : [];
    let settlement: Settlement | null = null;
    let raised: billing.KbInvoice;
    let changed = false;
    try {
      await billing.changePlan(plan.kb_subscription_id, carePlan(stored.to_tier), overridesFor(stored.to_tier, plan.currency, fresh.monthly));
      changed = true;
      raised = await changeInvoice(plan, before);
      await db.query("UPDATE care_plans SET tier = $2, monthly_minor = $3 WHERE id = $1", [plan.id, stored.to_tier, fresh.monthly.toString()]);
      await db.query("INSERT INTO invoice_pdfs (kb_invoice_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [raised.invoiceId, plan.order_id]);
      if (total > 0n) {
        const paymentId = randomUUID();
        await db.query(
          "INSERT INTO payments (id, order_id, kind, amount_minor, kb_payment_ids, kb_invoice_id, captured_at) VALUES ($1, $2, 'change', $3, $4, $5, $6)",
          [paymentId, plan.order_id, total.toString(), paymentIds, raised.invoiceId, now],
        );
        const account = await accountWithOwner(db, plan.account_id);
        await enqueue(
          db,
          messages.receipt({ key: paymentId, to: account.owner_email, orderId: plan.order_id, orderNumber: plan.order_number, kind: "Plan change", amount: total, currency: plan.currency }),
        );
        await billing.capture(paymentIds, plan.currency);
        const charged = billing.kbMinor(raised.balance);
        settlement = { kbAccountId: plan.kb_account_id, invoiceId: raised.invoiceId, amount: charged < total ? charged : total, paymentId };
      }
    } catch (error) {
      await billing.voidPayments(paymentIds).catch(() => undefined);
      // Billing must not keep a tier the ledger rolled back: change it back to the held tier and price.
      if (changed) {
        await billing
          .changePlan(plan.kb_subscription_id, carePlan(stored.from_tier), overridesFor(stored.from_tier, plan.currency, BigInt(plan.monthly_minor)))
          .catch(() => undefined);
      }
      throw error instanceof HttpError ? error : errors.billing();
    }
    if (settlement) await settle(settlement);
    const after = await readPlan(plan, new Date(), db);
    return {
      plan: after.plan,
      invoice: invoiceBody(raised, "change", plan.order_id, `${plan.order_number} change to ${PLAN_NAMES[carePlan(stored.to_tier)]}`, false),
    };
  });
}

// ---- pause, resume, cancel

export async function pause(accountId: string, now: Date) {
  return withPlanLock(accountId, async (db, plan) => {
    const view = await readPlan(plan, now, db);
    requireActive(view);
    await billing.pauseBundle(plan.kb_bundle_id, view.plan.chargedThrough!);
    return { plan: (await readPlan(plan, new Date(), db)).plan };
  });
}

export async function cancel(accountId: string, now: Date) {
  return withPlanLock(accountId, async (db, plan) => {
    const view = await readPlan(plan, now, db);
    requireActive(view);
    await billing.cancelAtPeriodEnd(plan.kb_subscription_id);
    return { plan: (await readPlan(plan, new Date(), db)).plan };
  });
}

export async function resume(accountId: string, now: Date) {
  return withPlanLock(accountId, async (db, plan) => {
    const view = await readPlan(plan, now, db);
    if (view.plan.status === "active" && view.scheduledPause) {
      await billing.resumeBundle(plan.kb_bundle_id, view.scheduledPause);
      return { plan: (await readPlan(plan, new Date(), db)).plan };
    }
    if (view.plan.status !== "paused") throw errors.invalidTransition(view.plan.status.replace("_", " "));
    if (!approves(plan.card_last4)) throw declined();
    const before = new Set(view.invoices.map((inv) => inv.invoiceId));
    await billing.resumeBundle(plan.kb_bundle_id);
    for (let tries = 0; tries < 40; tries++) {
      const invoices = await billing.accountInvoices(plan.kb_account_id);
      const raised = invoices.find((inv) => !before.has(inv.invoiceId) && billing.kbMinor(inv.balance) > 0n && inv.status === "COMMITTED");
      if (raised) {
        await chargeRenewal(db, plan, raised, now);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { plan: (await readPlan(plan, new Date(), db)).plan };
  });
}

// ---- renewals: card charges on renewal invoices, the card update and dunning

/** Charges an open renewal invoice with the card on file and records it as settled. */
async function chargeRenewal(db: Db, plan: PlanRow, inv: billing.KbInvoice, now: Date): Promise<void> {
  const amount = billing.kbMinor(inv.balance);
  const paymentIds = await billing.authorize(plan.kb_account_id, amount, plan.currency, `${inv.invoiceId}-renewal`);
  const paymentId = randomUUID();
  try {
    await db.query("SAVEPOINT renewal");
    await db.query(
      "INSERT INTO payments (id, order_id, kind, amount_minor, kb_payment_ids, kb_invoice_id, captured_at) VALUES ($1, $2, 'renewal', $3, $4, $5, $6)",
      [paymentId, plan.order_id, amount.toString(), paymentIds, inv.invoiceId, now],
    );
    await db.query(
      `INSERT INTO renewals (kb_invoice_id, plan_id, amount_minor, settled_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (kb_invoice_id) DO UPDATE SET settled_at = now(), next_attempt_at = NULL`,
      [inv.invoiceId, plan.id, amount.toString()],
    );
    await db.query("INSERT INTO invoice_pdfs (kb_invoice_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [inv.invoiceId, plan.order_id]);
    const account = await accountWithOwner(db, plan.account_id);
    await enqueue(
      db,
      messages.receipt({ key: paymentId, to: account.owner_email, orderId: plan.order_id, orderNumber: plan.order_number, kind: "Renewal", amount, currency: plan.currency }),
    );
    await billing.capture(paymentIds, plan.currency);
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT renewal");
    await billing.voidPayments(paymentIds).catch(() => undefined);
    throw error instanceof HttpError ? error : errors.billing();
  }
  await billing.setFailedAttempts(plan.kb_subscription_id, 0);
  await settle({ kbAccountId: plan.kb_account_id, invoiceId: inv.invoiceId, amount, paymentId });
}

export async function updateCard(accountId: string, body: unknown, now: Date) {
  const card = readCard(body, now);
  return withPlanLock(accountId, async (db, plan) => {
    if (!approves(card.last4)) throw declined();
    const view = await readPlan(plan, now, db);
    await db.query("UPDATE client_accounts SET card_last4 = $2 WHERE id = $1", [plan.account_id, card.last4]);
    if (view.plan.status === "past_due") {
      const open = openRenewal(view, plan, await paidInvoiceIds(plan, db));
      if (open) await chargeRenewal(db, { ...plan, card_last4: card.last4 }, open, now);
    }
    return { plan: (await readPlan(plan, new Date(), db)).plan };
  });
}

/** Finds unpaid renewal invoices Kill Bill raised: one invoice notice each, then attempt 1 at once. */
export async function discoverRenewals(): Promise<void> {
  const plans = await query<PlanRow>(`${PLAN_SELECT} WHERE a.kb_account_id IS NOT NULL`);
  for (const candidate of plans) {
    await tx(async (db) => {
      const locked = await rows(db, "SELECT 1 FROM care_plans WHERE id = $1 FOR UPDATE SKIP LOCKED", [candidate.id]);
      if (!locked.length) return;
      const invoices = await billing.accountInvoices(candidate.kb_account_id);
      const paid = await paidInvoiceIds(candidate, db);
      const known = new Set((await rows<{ kb_invoice_id: string }>(db, "SELECT kb_invoice_id FROM renewals WHERE plan_id = $1", [candidate.id])).map((r) => r.kb_invoice_id));
      const open = openRenewal({ invoices }, candidate, paid);
      if (!open || known.has(open.invoiceId)) return;
      const subscription = (await billing.kb("GET", `/subscriptions/${candidate.kb_subscription_id}`)).json as billing.KbSubscription;
      if (subscription.state === "CANCELLED") return;
      const amount = billing.kbMinor(open.balance);
      await db.query("INSERT INTO renewals (kb_invoice_id, plan_id, amount_minor, next_attempt_at) VALUES ($1, $2, $3, now())", [
        open.invoiceId,
        candidate.id,
        amount.toString(),
      ]);
      await db.query("INSERT INTO invoice_pdfs (kb_invoice_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [open.invoiceId, candidate.order_id]);
      const account = await accountWithOwner(db, candidate.account_id);
      await enqueue(
        db,
        messages.invoiceNotice({
          invoiceId: open.invoiceId,
          to: account.owner_email,
          invoiceNumber: open.invoiceNumber,
          amount: billing.kbMinor(open.amount),
          due: amount,
          currency: candidate.currency,
        }),
      );
    });
  }
}

interface RenewalRow extends Row {
  kb_invoice_id: string;
  plan_id: string;
  amount_minor: string;
  failed_attempts: number;
  first_attempt_at: Date | null;
}

/** Runs every renewal attempt that has fallen due: attempt 1 at once, 2 and 3 on the dunning days. */
export async function runDueAttempts(): Promise<void> {
  for (;;) {
    const ran = await tx(async (db) => {
      const [renewal] = await rows<RenewalRow>(
        db,
        `SELECT r.* FROM renewals r WHERE r.settled_at IS NULL AND r.cancelled_at IS NULL AND r.next_attempt_at <= now()
         ORDER BY r.next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!renewal) return false;
      const [plan] = await rows<PlanRow>(db, `${PLAN_SELECT} WHERE cp.id = $1 FOR UPDATE OF cp`, [renewal.plan_id]);
      if (!plan) return false;
      const at = new Date();
      const inv = await billing.invoice(renewal.kb_invoice_id);
      if (!inv || billing.kbMinor(inv.balance) <= 0n) {
        await db.query("UPDATE renewals SET settled_at = now(), next_attempt_at = NULL WHERE kb_invoice_id = $1", [renewal.kb_invoice_id]);
        return true;
      }
      if (approves(plan.card_last4)) {
        await chargeRenewal(db, plan, inv, at);
        return true;
      }
      const attempt = renewal.failed_attempts + 1;
      const first = renewal.first_attempt_at ?? at;
      const day = config.dunningDaySeconds * 1000;
      const next = attempt === 1 ? new Date(first.getTime() + 3 * day) : attempt === 2 ? new Date(first.getTime() + 7 * day) : null;
      await billing.setFailedAttempts(plan.kb_subscription_id, attempt);
      if (!next) await billing.cancelNow(plan.kb_subscription_id);
      await db.query("INSERT INTO dunning_attempts (kb_invoice_id, attempt, outcome) VALUES ($1, $2, 'declined')", [renewal.kb_invoice_id, attempt]);
      await db.query(
        `UPDATE renewals SET failed_attempts = $2, first_attempt_at = $3, next_attempt_at = $4, cancelled_at = $5 WHERE kb_invoice_id = $1`,
        [renewal.kb_invoice_id, attempt, first, next, next ? null : at],
      );
      const account = await accountWithOwner(db, plan.account_id);
      await enqueue(
        db,
        messages.dunning({
          invoiceId: renewal.kb_invoice_id,
          to: account.owner_email,
          attempt,
          amount: BigInt(renewal.amount_minor),
          currency: plan.currency,
          nextRetry: next ? studioDate(next) : null,
        }),
      );
      return true;
    });
    if (!ran) return;
  }
}
