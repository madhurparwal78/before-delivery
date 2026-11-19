import type { PoolClient } from 'pg';
import { inTransaction, pool } from './db/pool.js';
import { config } from './config.js';
import { ApiError } from './http/errors.js';
import { PLAN_LABELS, effectivePlan, planStateFromOverdue, rateFor } from './domain/plans.js';
import { enqueue } from './domain/queue.js';
import * as killbill from './providers/killbill.js';
import { ProviderUnreachable } from './providers/http.js';
import { setKeyRate } from './providers/valkey.js';
import type { BillingState, Member, Plan, Venue } from './domain/types.js';
import type { Invoice } from './providers/killbill.js';

export const billingUnavailable = (): ApiError => new ApiError(503, 'billing_unavailable');

export const killbillAccountKey = (venueSlug: string, memberId: string): string =>
  `${venueSlug}:${memberId}`;
export const planBundleKey = (memberId: string): string => `plan-${memberId}`;

interface BillingRow {
  member_id: string;
  venue_id: string;
  plan: Plan;
  state: BillingState;
  overdue_state: string;
  pending_plan: Plan | null;
  pending_effective_date: Date | null;
  subscription_id: string | null;
  payment_failed_at: Date | null;
  final_notice_sent_at: Date | null;
}

const COLUMNS =
  'member_id, venue_id, plan, state, overdue_state, pending_plan, pending_effective_date, subscription_id, payment_failed_at, final_notice_sent_at';

export async function ensureBillingRow(client: PoolClient, member: Member): Promise<BillingRow> {
  await client.query(
    `insert into builder_billing (member_id, venue_id, plan, state, overdue_state)
     values ($1,$2,'sandbox','active',$3) on conflict (member_id) do nothing`,
    [member.id, member.venue_id, killbill.CLEAR_OVERDUE_STATE],
  );
  const result = await client.query<BillingRow>(
    `select ${COLUMNS} from builder_billing where member_id = $1 for update`,
    [member.id],
  );
  return result.rows[0] as BillingRow;
}

/** Sets every one of the builder's keys to the effective plan's rate in the same step. */
async function applyKeyRates(client: PoolClient, memberId: string, plan: Plan): Promise<void> {
  const keys = await client.query<{ key_id: string }>(
    'select key_id from api_keys where member_id = $1 and revoked_at is null',
    [memberId],
  );
  const rate = rateFor(plan);
  for (const key of keys.rows) await setKeyRate(key.key_id, rate);
}

const EMAIL_SUBJECTS = {
  payment_failed: (plan: Plan): string => `Payment failed — your ${PLAN_LABELS[plan]} plan`,
  final_notice: (plan: Plan): string => `Final notice — your ${PLAN_LABELS[plan]} plan`,
  downgraded: (): string => 'Your plan is now Sandbox',
  active: (plan: Plan): string => `Your ${PLAN_LABELS[plan]} plan is active again`,
};

async function sendStateEmail(
  client: PoolClient,
  member: Member,
  state: BillingState,
  plan: Plan,
  stamp: string,
): Promise<void> {
  const subject =
    state === 'payment_failed'
      ? EMAIL_SUBJECTS.payment_failed(plan)
      : state === 'downgraded'
        ? EMAIL_SUBJECTS.downgraded()
        : EMAIL_SUBJECTS.active(plan);
  const body =
    state === 'payment_failed'
      ? `Your last plan payment failed. Pay the outstanding balance at ${config.app.publicUrl}/builder to keep your ${PLAN_LABELS[plan]} rate.`
      : state === 'downgraded'
        ? `Your plan is downgraded to Sandbox until the outstanding invoice is paid. Pay it at ${config.app.publicUrl}/builder.`
        : `Your ${PLAN_LABELS[plan]} plan is active again and your API keys have their ${PLAN_LABELS[plan]} rate back.`;
  await enqueue(client, 'email', `billing:${member.id}:${state}:${stamp}`, {
    to: member.email,
    subject,
    body,
  });
}

/** The builder's plan state follows Kill Bill's overdue state; the rate changes in the same step. */
async function recordOverdueState(
  client: PoolClient,
  member: Member,
  row: BillingRow,
  overdueState: string,
): Promise<BillingRow> {
  const state = planStateFromOverdue(overdueState);
  if (state === row.state && overdueState === row.overdue_state) return row;

  const paymentFailedAt = state === 'payment_failed' ? (row.payment_failed_at ?? new Date()) : null;
  const updated = await client.query<BillingRow>(
    `update builder_billing
        set state = $2, overdue_state = $3, payment_failed_at = $4,
            final_notice_sent_at = case when $2 = 'payment_failed' then final_notice_sent_at else null end,
            updated_at = now()
      where member_id = $1
      returning ${COLUMNS}`,
    [member.id, state, overdueState, paymentFailedAt],
  );
  const next = updated.rows[0] as BillingRow;
  await applyKeyRates(client, member.id, effectivePlan(next.plan, state));
  if (state !== row.state) {
    await sendStateEmail(client, member, state, next.plan, `${Date.now()}`);
  }
  return next;
}

async function finalNotice(client: PoolClient, member: Member, row: BillingRow): Promise<void> {
  if (row.state !== 'payment_failed' || row.payment_failed_at === null) return;
  if (row.final_notice_sent_at !== null) return;
  const elapsed = (Date.now() - row.payment_failed_at.getTime()) / 1000;
  if (elapsed < config.app.dunningFinalNoticeSeconds) return;
  await client.query('update builder_billing set final_notice_sent_at = now() where member_id = $1', [
    member.id,
  ]);
  await enqueue(client, 'email', `billing:${member.id}:final_notice`, {
    to: member.email,
    subject: EMAIL_SUBJECTS.final_notice(row.plan),
    body: `Your ${PLAN_LABELS[row.plan]} plan still has an outstanding balance. Pay it at ${config.app.publicUrl}/builder.`,
  });
}

export interface BillingView {
  plan: Plan;
  effective_plan: Plan;
  state: BillingState;
  overdue_state: string;
  rate_per_second: number;
  pending_plan: Plan | null;
  pending_effective_date: string | null;
  provider: 'ok' | 'unavailable';
  invoices: Invoice[];
}

const localDate = (value: Date | null): string | null =>
  value === null ? null : value.toISOString().slice(0, 10);

function view(row: BillingRow, provider: 'ok' | 'unavailable', invoices: Invoice[]): BillingView {
  const effective = effectivePlan(row.plan, row.state);
  return {
    plan: row.plan,
    effective_plan: effective,
    state: row.state,
    overdue_state: row.overdue_state,
    rate_per_second: rateFor(effective),
    pending_plan: row.pending_plan,
    pending_effective_date: localDate(row.pending_effective_date),
    provider,
    invoices,
  };
}

/** Re-reads Kill Bill on every call; a pending downgrade takes effect on the date Kill Bill reports. */
export async function readBilling(member: Member, venue: Venue): Promise<BillingView> {
  try {
    const accountId = await killbill.ensureAccount(
      killbillAccountKey(venue.slug, member.id),
      member.display_name,
      member.email,
      null,
    );
    const [overdue, invoices, subscription] = await Promise.all([
      killbill.overdueState(accountId),
      killbill.invoices(accountId),
      killbill.activeSubscription(accountId, planBundleKey(member.id)),
    ]);
    return await inTransaction(async (client) => {
      let row = await ensureBillingRow(client, member);
      row = await applySubscription(client, member, row, subscription);
      row = await recordOverdueState(client, member, row, overdue.name);
      await finalNotice(client, member, row);
      const fresh = await client.query<BillingRow>(
        `select ${COLUMNS} from builder_billing where member_id = $1`,
        [member.id],
      );
      return view(fresh.rows[0] as BillingRow, 'ok', invoices);
    });
  } catch (error) {
    if (!(error instanceof ProviderUnreachable)) throw error;
    return inTransaction(async (client) => {
      const row = await ensureBillingRow(client, member);
      return view(row, 'unavailable', []);
    });
  }
}

const PLAN_OF_NAME = new Map<string, Plan>(
  Object.entries(killbill.PLAN_NAMES).map(([plan, name]) => [name, plan as Plan]),
);

/** Reconciles the stored plan with the subscription Kill Bill reports. */
async function applySubscription(
  client: PoolClient,
  member: Member,
  row: BillingRow,
  subscription: killbill.Subscription | null,
): Promise<BillingRow> {
  if (subscription === null) {
    if (row.plan === 'sandbox' && row.subscription_id === null && row.pending_plan === null) return row;
    const cleared = await client.query<BillingRow>(
      `update builder_billing set plan = 'sandbox', subscription_id = null, pending_plan = null,
              pending_effective_date = null, updated_at = now()
        where member_id = $1 returning ${COLUMNS}`,
      [member.id],
    );
    return cleared.rows[0] as BillingRow;
  }
  const actual = PLAN_OF_NAME.get(subscription.planName);
  if (actual === undefined) return row;
  const pendingReached =
    row.pending_plan !== null && actual === row.pending_plan ? null : row.pending_plan;
  if (actual === row.plan && row.subscription_id === subscription.subscriptionId && pendingReached === row.pending_plan) {
    return row;
  }
  const updated = await client.query<BillingRow>(
    `update builder_billing set plan = $2, subscription_id = $3, pending_plan = $4,
            pending_effective_date = $5, updated_at = now()
      where member_id = $1 returning ${COLUMNS}`,
    [
      member.id,
      actual,
      subscription.subscriptionId,
      pendingReached,
      pendingReached === null ? null : localDate(row.pending_effective_date),
    ],
  );
  return updated.rows[0] as BillingRow;
}

export async function keyRateFor(memberId: string): Promise<number> {
  const result = await pool.query<{ plan: Plan; state: BillingState }>(
    'select plan, state from builder_billing where member_id = $1',
    [memberId],
  );
  const row = result.rows[0];
  return rateFor(row === undefined ? 'sandbox' : effectivePlan(row.plan, row.state));
}
