import { query, one, withTransaction, type DbClient } from '../db/db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { PLAN_ORDER, isUpgrade, kbPlanNameOf, planFromKbPlanName, planOf, type PlanId } from './plans.js';
import * as kb from '../providers/billing.js';
import type { KbSubscription } from '../providers/billing.js';
import { recomputeReadOnly, cycleBounds, currentCycleBounds, countPublishes, type CycleBounds } from './models.js';
import { queueEmail } from '../providers/email.js';
import { markService } from '../providers/availability.js';

export interface PlanStateRow {
  plan: PlanId;
  billing_cycle_day: number;
  pending_plan: string | null;
  pending_effective_date: string | null;
  charged_cents: number | null;
  confirmed_at: string | null;
  kb_account_id: string | null;
  kb_subscription_id: string | null;
  kb_bundle_id: string | null;
  kb_payment_method_id: string | null;
  last_seen_at: string | null;
}

export async function planState(): Promise<PlanStateRow> {
  const row = await one<PlanStateRow>('SELECT plan, billing_cycle_day, pending_plan, pending_effective_date, charged_cents, confirmed_at, kb_account_id, kb_subscription_id, kb_bundle_id, kb_payment_method_id, last_seen_at FROM plan_state WHERE id = 1');
  return (
    row ?? {
      plan: 'free',
      billing_cycle_day: 1,
      pending_plan: null,
      pending_effective_date: null,
      charged_cents: null,
      confirmed_at: null,
      kb_account_id: null,
      kb_subscription_id: null,
      kb_bundle_id: null,
      kb_payment_method_id: null,
      last_seen_at: null,
    }
  );
}

/** A pending change is a future CHANGE event whose plan differs from the active one. */
export function pendingChangeOf(subscription: KbSubscription): { plan: PlanId; date: string } | null {
  const today = new Date().toISOString().slice(0, 10);
  const future = (subscription.events ?? [])
    .filter(event => event.eventType === 'CHANGE')
    .filter(event => event.plan !== subscription.planName)
    .filter(event => event.effectiveDate.slice(0, 10) > today);
  if (future.length === 0) return null;
  const latest = future.reduce((acc, candidate) => (candidate.effectiveDate > acc.effectiveDate ? candidate : acc));
  return { plan: planFromKbPlanName(latest.plan), date: latest.effectiveDate.slice(0, 10) };
}

export interface QuotaInfo {
  used: number;
  limit: number | null;
  resets_on: string;
}

export async function quotaInfo(): Promise<QuotaInfo> {
  const state = await planState();
  const plan = planOf(state.plan);
  const cycle = cycleBounds(state.billing_cycle_day);
  const usedRow = await one<{ count: string }>(
    'SELECT count(*)::text AS count FROM publish_events WHERE created_at >= $1 AND created_at < $2',
    [cycle.start, cycle.end],
  );
  return { used: Number(usedRow?.count ?? '0'), limit: plan.publishesPerCycle, resets_on: cycle.resetsOn };
}

/** Ensures the Kill Bill catalogue, author account and Pro subscription exist. */
export async function ensureBillingSetup(): Promise<void> {
  const versions = await kb.catalogVersions();
  if (versions.length === 0) {
    await kb.uploadCatalog('2020-01-01T00:00:00.000+00:00');
  }
  const externalKey = `turnstone-${config.instance}-author`;
  let account = await kb.getAccountByExternalKey(externalKey);
  if (account === null) {
    account = await kb.createAccount(externalKey, 'author@ashgrove.test');
    await kb.createExternalPaymentMethod(account.accountId, `${externalKey}-pm`);
  }
  const bundles = await kb.getBundles(account.accountId);
  const bundleKey = `turnstone-${config.instance}-studio-plan`;
  let bundle = bundles.find(b => b.externalKey === bundleKey);
  if (bundle === undefined) {
    await kb.createSubscription(account.accountId, bundleKey, kbPlanNameOf('pro'));
    bundle = (await kb.getBundles(account.accountId)).find(b => b.externalKey === bundleKey);
  }
  const subscription = bundle?.subscriptions[0];
  if (subscription === undefined) throw new Error('author subscription missing');
  const methods = await kb.listPaymentMethods(account.accountId);
  const method = methods.find(m => m.pluginName === '__EXTERNAL_PAYMENT__');
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO plan_state (id, plan, billing_cycle_day, kb_account_id, kb_subscription_id, kb_bundle_id, kb_payment_method_id, confirmed_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         kb_account_id = COALESCE(plan_state.kb_account_id, EXCLUDED.kb_account_id),
         kb_subscription_id = COALESCE(plan_state.kb_subscription_id, EXCLUDED.kb_subscription_id),
         kb_bundle_id = COALESCE(plan_state.kb_bundle_id, EXCLUDED.kb_bundle_id),
         kb_payment_method_id = COALESCE(plan_state.kb_payment_method_id, EXCLUDED.kb_payment_method_id)`,
      ['pro', subscription.billCycleDayLocal, account.accountId, subscription.subscriptionId, bundle?.bundleId ?? null, method?.paymentMethodId ?? null],
    );
  });
  markService('billing', true);
}

/** Reads the plan Kill Bill reports as active and applies entitlement changes within the window. */
export async function refreshPlanFromBilling(): Promise<boolean> {
  const state = await planState();
  if (state.kb_account_id === null || state.kb_subscription_id === null) return false;
  const bundles = await kb.getBundles(state.kb_account_id);
  const bundle = bundles.find(b => b.externalKey === `turnstone-${config.instance}-studio-plan`);
  const subscription = bundle?.subscriptions.find(s => s.state === 'ACTIVE') ?? bundle?.subscriptions[0];
  if (subscription === undefined) return false;
  const activePlan = planFromKbPlanName(subscription.planName);
  const pending = pendingChangeOf(subscription);
  const pendingPlan = pending === null ? null : pending.plan;
  const pendingDate = pending === null ? null : pending.date;

  const row = await one<{ plan: string; pending_plan: string | null; pending_effective_date: string | null }>(
    'SELECT plan, pending_plan, pending_effective_date FROM plan_state WHERE id = 1',
  );
  if (row === null) return false;
  const changed = row.plan !== activePlan || row.pending_plan !== pendingPlan || row.pending_effective_date !== pendingDate;
  if (!changed) {
    await query('UPDATE plan_state SET last_seen_at = now() WHERE id = 1');
    return false;
  }
  await withTransaction(async client => {
    await applyPlanChangeInDb(client, activePlan, pendingPlan, pendingDate);
  });
  return true;
}

/** Applies a newly reported active plan: entitlements follow in both directions. */
export async function applyPlanChangeInDb(
  client: DbClient,
  activePlan: PlanId,
  pendingPlan: string | null,
  pendingDate: string | null,
): Promise<void> {
  await client.query(
    'UPDATE plan_state SET plan = $2, pending_plan = $3, pending_effective_date = $4, confirmed_at = now(), last_seen_at = now() WHERE id = $1',
    [1, activePlan, pendingPlan, pendingDate],
  );
  await recomputeReadOnly(client, activePlan);
}

export interface PlanChangeResult {
  status: number;
  plan: PlanId;
  pending: { plan: PlanId; effective_date: string } | null;
  charged_cents: number | null;
}

/** One plan change: upgrades apply at once with proration, downgrades at the confirmed date. */
export async function changePlan(target: PlanId): Promise<PlanChangeResult> {
  const state = await planState();
  const current = state.plan;
  if (current === target) throw new ApiError(409, 'plan_unchanged');
  if (state.kb_subscription_id === null || state.kb_account_id === null) {
    throw new ApiError(503, 'billing_unavailable');
  }
  const beforeInvoiceIds = await kb.listInvoiceIds(state.kb_account_id);

  const policy = isUpgrade(current, target) ? 'IMMEDIATE' : 'END_OF_TERM';
  await kb.changePlan(state.kb_subscription_id, kbPlanNameOf(target), policy);

  if (policy === 'IMMEDIATE') {
    // The prorated amount Kill Bill invoiced: the new invoice created by the change.
    const charged = await findProrationCharge(state.kb_account_id, beforeInvoiceIds, target);
    await withTransaction(async client => {
      await applyPlanChangeInDb(client, target, null, null);
      await client.query('UPDATE plan_state SET charged_cents = $1 WHERE id = 1', [charged]);
    });
    await queueEmail({
      kind: 'plan_upgrade',
      plan: target,
      effectiveDate: null,
      chargedCents: charged,
      authorEmail: (await authorEmail()) ?? 'author@ashgrove.test',
    });
    return { status: 200, plan: target, pending: null, charged_cents: charged };
  }

  const bundles = await kb.getBundles(state.kb_account_id);
  const bundle = bundles.find(b => b.externalKey === `turnstone-${config.instance}-studio-plan`);
  const subscription = bundle?.subscriptions.find(s => s.state === 'ACTIVE') ?? bundle?.subscriptions[0];
  const pending = subscription === undefined ? null : pendingChangeOf(subscription);
  const effectiveDate = pending === null ? null : pending.date;
  await withTransaction(async client => {
    await client.query(
      'UPDATE plan_state SET pending_plan = $1, pending_effective_date = $2 WHERE id = 1',
      [target, effectiveDate],
    );
  });
  await queueEmail({
    kind: 'plan_downgrade',
    plan: target,
    effectiveDate,
    chargedCents: null,
    authorEmail: (await authorEmail()) ?? 'author@ashgrove.test',
  });
  return { status: 202, plan: current, pending: { plan: target, effective_date: effectiveDate ?? '' }, charged_cents: null };
}

async function findProrationCharge(accountId: string, beforeInvoiceIds: string[], target: PlanId): Promise<number> {
  const afterIds = await kb.listInvoiceIds(accountId);
  const fresh = afterIds.filter(id => !beforeInvoiceIds.includes(id));
  let charged = planOf(target).monthlyCents;
  for (const invoiceId of fresh) {
    const invoice = await kb.getInvoice(invoiceId);
    if (invoice.items.some(item => item.planName === kbPlanNameOf(target))) {
      charged = Math.max(0, kb.eurToCents(invoice.amount));
    }
  }
  return charged;
}

async function authorEmail(): Promise<string | null> {
  const row = await one<{ email: string }>(`SELECT email FROM users WHERE role = 'author' LIMIT 1`);
  return row?.email ?? null;
}

/** Applies a downgrade whose confirmed date has arrived. */
export async function applyDueDowngrades(): Promise<boolean> {
  const state = await planState();
  if (state.pending_plan === null || state.pending_effective_date === null) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (state.pending_effective_date > today) return false;
  const bundles = state.kb_account_id === null ? [] : await kb.getBundles(state.kb_account_id);
  const bundle = bundles.find(b => b.externalKey === `turnstone-${config.instance}-studio-plan`);
  const subscription = bundle?.subscriptions.find(s => s.state === 'ACTIVE') ?? bundle?.subscriptions[0];
  if (subscription === undefined || subscription.planName !== kbPlanNameOf(state.pending_plan as PlanId)) {
    return false;
  }
  await withTransaction(async client => {
    await applyPlanChangeInDb(client, planFromKbPlanName(subscription.planName), null, null);
  });
  return true;
}

export async function currentCycle(): Promise<CycleBounds> {
  return withTransaction(client => currentCycleBounds(client));
}

export { countPublishes };
