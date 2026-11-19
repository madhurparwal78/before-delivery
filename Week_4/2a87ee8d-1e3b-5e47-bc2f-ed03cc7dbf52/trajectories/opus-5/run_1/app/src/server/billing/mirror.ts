import type { PoolClient } from 'pg';
import { pool, withTransaction, type Queryable } from '../db/pool.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { decimalToCents } from '../domain/money.js';
import {
  entitlementsFor,
  killbillPlanName,
  type BillingState,
  type BillingTerm,
  type Entitlements,
  type PlanCode,
} from '../domain/plans.js';
import { isoDateIn, isoTimestamp } from '../domain/schedule.js';
import * as killbill from '../services/killbill.js';
import { BillingUnavailable } from '../services/killbill.js';

export interface FacilitatorRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly timeZone: string;
  readonly seedPlan: PlanCode;
  readonly seedTerm: BillingTerm;
}

export async function findFacilitator(executor: Queryable, facilitatorId: string): Promise<FacilitatorRecord> {
  const result = await executor.query<{
    id: string;
    email: string;
    name: string;
    time_zone: string;
    seed_plan: PlanCode;
    seed_term: BillingTerm;
  }>('SELECT id, email, name, time_zone, seed_plan, seed_term FROM facilitators WHERE id = $1', [facilitatorId]);
  const row = result.rows[0];
  if (!row) throw new AppError('not_found');
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    timeZone: row.time_zone,
    seedPlan: row.seed_plan,
    seedTerm: row.seed_term,
  };
}

export interface MirrorRow {
  readonly plan: PlanCode;
  readonly term: BillingTerm;
  readonly renewsOn: string | null;
  readonly pendingChange: { plan: PlanCode; term: BillingTerm; effectiveDate: string } | null;
  readonly accountBalanceCents: number;
  readonly pastDueSinceMs: number | null;
  readonly syncedAtMs: number | null;
  readonly killbillAccountId: string | null;
  readonly killbillSubscriptionId: string | null;
}

export async function readMirror(executor: Queryable, facilitatorId: string): Promise<MirrorRow> {
  const result = await executor.query<{
    plan: PlanCode;
    term: BillingTerm;
    renews_on: Date | null;
    pending_plan: PlanCode | null;
    pending_term: BillingTerm | null;
    pending_effective_date: Date | null;
    account_balance_cents: number;
    past_due_since: Date | null;
    synced_at: Date | null;
    kb_account_id: string | null;
    kb_subscription_id: string | null;
  }>(
    `SELECT plan, term, renews_on, pending_plan, pending_term, pending_effective_date,
            account_balance_cents, past_due_since, synced_at, kb_account_id, kb_subscription_id
       FROM billing_mirror WHERE facilitator_id = $1`,
    [facilitatorId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('not_found');
  const pendingChange =
    row.pending_plan !== null && row.pending_term !== null && row.pending_effective_date !== null
      ? {
          plan: row.pending_plan,
          term: row.pending_term,
          effectiveDate: isoDateFromColumn(row.pending_effective_date),
        }
      : null;
  return {
    plan: row.plan,
    term: row.term,
    renewsOn: row.renews_on === null ? null : isoDateFromColumn(row.renews_on),
    pendingChange,
    accountBalanceCents: Number(row.account_balance_cents),
    pastDueSinceMs: row.past_due_since?.getTime() ?? null,
    syncedAtMs: row.synced_at?.getTime() ?? null,
    killbillAccountId: row.kb_account_id,
    killbillSubscriptionId: row.kb_subscription_id,
  };
}

/** A `date` column arrives as a Date at local midnight; its calendar date is what matters. */
function isoDateFromColumn(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/**
 * `readOnlyAt` is `pastDueSince` plus the grace period; each instance computes it from the
 * mirrored instant and its own `PAYMENT_GRACE_SECONDS`.
 */
function readOnlyAtMs(pastDueSinceMs: number | null): number | null {
  return pastDueSinceMs === null ? null : pastDueSinceMs + config.paymentGraceSeconds * 1000;
}

function billingStateOf(mirror: MirrorRow, nowMs: number): BillingState {
  if (mirror.pastDueSinceMs === null) return 'active';
  const readOnly = readOnlyAtMs(mirror.pastDueSinceMs);
  return readOnly !== null && nowMs >= readOnly ? 'read_only' : 'past_due';
}

export interface InvoiceRecord {
  readonly id: string;
  readonly number: string;
  readonly date: string;
  readonly amount: string;
  readonly balance: string;
  readonly currency: string;
  readonly status: 'paid' | 'unpaid';
}

export async function listMirroredInvoices(
  executor: Queryable,
  facilitatorId: string,
): Promise<InvoiceRecord[]> {
  const result = await executor.query<{
    id: string;
    number: string;
    invoice_date: Date;
    amount: string;
    balance: string;
    currency: string;
  }>(
    `SELECT id, number, invoice_date, amount, balance, currency
       FROM facilitator_invoices WHERE facilitator_id = $1
      ORDER BY invoice_date DESC, recorded_at DESC`,
    [facilitatorId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    number: row.number,
    date: isoDateFromColumn(row.invoice_date),
    amount: row.amount,
    balance: row.balance,
    currency: row.currency,
    status: decimalToCents(row.balance) > 0 ? 'unpaid' : 'paid',
  }));
}

async function storeInvoices(
  client: PoolClient,
  facilitatorId: string,
  invoices: readonly killbill.Invoice[],
): Promise<void> {
  for (const invoice of invoices) {
    await client.query(
      `INSERT INTO facilitator_invoices (id, facilitator_id, number, invoice_date, amount, balance, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, amount = EXCLUDED.amount`,
      [
        invoice.id,
        facilitatorId,
        invoice.number,
        invoice.date,
        invoice.amount,
        invoice.balance,
        invoice.currency,
      ],
    );
  }
}

/**
 * Makes sure the facilitator has exactly one Kill Bill account with a default payment method
 * and one subscription, then mirrors what Kill Bill reports into Postgres.
 *
 * Entitlements always come from the subscription Kill Bill reports; a cancelled subscription,
 * or none at all, means Free.
 */
export async function refreshMirror(facilitatorId: string, nowMs: number): Promise<void> {
  const facilitator = await findFacilitator(pool, facilitatorId);
  const accountId = await killbill.ensureAccount({
    name: facilitator.name,
    externalKey: `facilitator:${facilitator.email}`,
    email: facilitator.email,
    timeZone: facilitator.timeZone,
  });
  await killbill.ensureDefaultPaymentMethod(accountId);

  let subscription = await killbill.findBaseSubscription(accountId, nowMs);
  if (subscription === null) {
    const subscriptionId = await killbill.createSubscription(
      accountId,
      killbillPlanName(facilitator.seedPlan, facilitator.seedTerm),
    );
    subscription = await killbill.getSubscription(subscriptionId, nowMs);
  }

  const plan: PlanCode = subscription === null || subscription.cancelled ? 'free' : subscription.plan;
  const term: BillingTerm = subscription === null || subscription.cancelled ? 'monthly' : subscription.term;
  const invoices = await killbill.listInvoices(accountId);
  const balance = await killbill.accountBalance(accountId);
  const balanceCents = decimalToCents(balance);

  await withTransaction(async (client) => {
    await storeInvoices(client, facilitatorId, invoices);
    // At the first refresh that sees a balance above zero the account becomes past due;
    // a zero balance clears it.
    await client.query(
      `UPDATE billing_mirror
          SET plan = $2, term = $3, renews_on = $4,
              pending_plan = $5, pending_term = $6, pending_effective_date = $7,
              account_balance_cents = $8::bigint,
              past_due_since = CASE
                WHEN $8::bigint > 0 THEN coalesce(past_due_since, $9::timestamptz)
                ELSE NULL
              END,
              synced_at = $9::timestamptz,
              kb_account_id = $10,
              kb_subscription_id = $11
        WHERE facilitator_id = $1`,
      [
        facilitatorId,
        plan,
        term,
        subscription?.chargedThroughDate ?? null,
        subscription?.pendingChange?.plan ?? null,
        subscription?.pendingChange?.term ?? null,
        subscription?.pendingChange?.effectiveDate ?? null,
        balanceCents,
        new Date(nowMs),
        accountId,
        subscription?.subscriptionId ?? null,
      ],
    );
  });
}

/** Refreshes the mirror, reporting whether Kill Bill answered. */
export async function tryRefreshMirror(facilitatorId: string, nowMs: number): Promise<boolean> {
  try {
    await refreshMirror(facilitatorId, nowMs);
    return true;
  } catch (error) {
    if (error instanceof BillingUnavailable) return false;
    throw error;
  }
}

export interface BillingUsage {
  readonly activeWorkshops: number;
  readonly invitesToday: number;
}

export async function readUsage(
  executor: Queryable,
  facilitatorId: string,
  localDay: string,
): Promise<BillingUsage> {
  const [workshops, invites] = await Promise.all([
    executor.query<{ total: number }>(
      `SELECT count(*)::bigint AS total FROM workshops WHERE facilitator_id = $1 AND status <> 'archived'`,
      [facilitatorId],
    ),
    executor.query<{ used: number }>(
      `SELECT used FROM invite_quota WHERE facilitator_id = $1 AND local_day = $2`,
      [facilitatorId, localDay],
    ),
  ]);
  return {
    activeWorkshops: workshops.rows[0]?.total ?? 0,
    invitesToday: invites.rows[0]?.used ?? 0,
  };
}

export interface BillingObject {
  readonly plan: PlanCode;
  readonly term: BillingTerm;
  readonly state: BillingState;
  readonly pastDueSince: string | null;
  readonly readOnlyAt: string | null;
  readonly renewsOn: string | null;
  readonly pendingChange: { plan: PlanCode; term: BillingTerm; effectiveDate: string } | null;
  readonly entitlements: Entitlements;
  readonly usage: BillingUsage;
  readonly invoices: readonly InvoiceRecord[];
  readonly stale: boolean;
  readonly syncedAt: string | null;
}

/** Builds the billing object the API publishes, entirely from the mirror. */
export async function buildBillingObject(
  facilitatorId: string,
  timeZone: string,
  nowMs: number,
  stale: boolean,
): Promise<BillingObject> {
  const mirror = await readMirror(pool, facilitatorId);
  const [usage, invoices] = await Promise.all([
    readUsage(pool, facilitatorId, isoDateIn(nowMs, timeZone)),
    listMirroredInvoices(pool, facilitatorId),
  ]);
  const readOnly = readOnlyAtMs(mirror.pastDueSinceMs);
  return {
    plan: mirror.plan,
    term: mirror.term,
    state: billingStateOf(mirror, nowMs),
    pastDueSince: mirror.pastDueSinceMs === null ? null : isoTimestamp(mirror.pastDueSinceMs),
    readOnlyAt: readOnly === null ? null : isoTimestamp(readOnly),
    renewsOn: mirror.renewsOn,
    pendingChange: mirror.pendingChange,
    entitlements: entitlementsFor(mirror.plan),
    usage,
    invoices,
    stale,
    syncedAt: mirror.syncedAtMs === null ? null : isoTimestamp(mirror.syncedAtMs),
  };
}

/**
 * While the account is read-only, every write in that facilitator's workspace answers
 * `payment_required`. Joining counts as a write.
 */
export async function assertWorkspaceWritable(facilitatorId: string, nowMs: number): Promise<void> {
  const mirror = await readMirror(pool, facilitatorId);
  if (billingStateOf(mirror, nowMs) === 'read_only') throw new AppError('payment_required');
}
