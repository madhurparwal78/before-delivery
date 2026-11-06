import { query, queryOne } from './pool.js';
import type { PlanName } from '../domain/plans.js';
import { isPlanName, plan } from '../domain/plans.js';
import { billingCycle, isoDate } from '../domain/billing-cycle.js';
import * as killbill from '../services/killbill.js';
import { queueIndexWork, resyncForPlan } from '../services/indexer.js';

interface PlanStateRow {
  active_plan: string | null;
  pending_plan: string | null;
  pending_effective_date: Date | null;
  billing_cycle_day: number | null;
  confirmed_at: Date | null;
  killbill_account_id: string | null;
  killbill_subscription_id: string | null;
}

export interface PlanState {
  /** The plan the studio shows and enforces. */
  readonly plan: PlanName;
  readonly pendingPlan: PlanName | null;
  readonly pendingEffectiveDate: string | null;
  readonly billingCycleDay: number;
  readonly confirmedAt: string | null;
  readonly accountId: string | null;
  readonly subscriptionId: string | null;
}

/** On a database that has never reached Kill Bill, the app enforces Free. */
const FALLBACK_PLAN: PlanName = 'free';

function toState(row: PlanStateRow | null): PlanState {
  const active = row?.active_plan;
  const pending = row?.pending_plan;
  return {
    plan: isPlanName(active) ? active : FALLBACK_PLAN,
    pendingPlan: isPlanName(pending) ? pending : null,
    pendingEffectiveDate:
      row?.pending_effective_date == null ? null : isoDate(row.pending_effective_date),
    billingCycleDay: row?.billing_cycle_day ?? 1,
    confirmedAt: row?.confirmed_at?.toISOString() ?? null,
    accountId: row?.killbill_account_id ?? null,
    subscriptionId: row?.killbill_subscription_id ?? null,
  };
}

export async function storedPlanState(): Promise<PlanState> {
  return toState(await queryOne<PlanStateRow>(`SELECT * FROM plan_state WHERE id = 1`));
}

export async function rememberAccount(
  accountId: string,
  subscriptionId: string,
): Promise<void> {
  await query(
    `UPDATE plan_state SET killbill_account_id = $1, killbill_subscription_id = $2 WHERE id = 1`,
    [accountId, subscriptionId],
  );
}

async function storeReport(report: killbill.PlanReport): Promise<void> {
  await query(
    `UPDATE plan_state
     SET active_plan = $1, pending_plan = $2, pending_effective_date = $3,
         billing_cycle_day = $4, confirmed_at = now()
     WHERE id = 1`,
    [report.plan, report.pendingPlan, report.pendingEffectiveDate, report.billingCycleDay],
  );
}

let lastReadAt = 0;
const READ_INTERVAL_MS = 8_000;
let inFlight: Promise<PlanState> | null = null;

async function readFromBilling(): Promise<PlanState> {
  const stored = await storedPlanState();
  if (stored.subscriptionId === null) return stored;
  try {
    const report = await killbill.readPlan(stored.subscriptionId);
    await storeReport(report);
    if (report.plan !== stored.plan) {
      void queueIndexWork(() => resyncForPlan(report.plan));
    }
    lastReadAt = Date.now();
    return {
      ...stored,
      plan: report.plan,
      pendingPlan: report.pendingPlan,
      pendingEffectiveDate: report.pendingEffectiveDate,
      billingCycleDay: report.billingCycleDay,
      confirmedAt: new Date().toISOString(),
    };
  } catch {
    // Kill Bill is unreachable: the app enforces the last plan it confirmed.
    return stored;
  }
}

/**
 * The active plan, refreshed from Kill Bill at least every eight seconds so a
 * change made outside the app takes effect within twenty.
 */
export async function activePlanState(): Promise<PlanState> {
  if (Date.now() - lastReadAt < READ_INTERVAL_MS) return storedPlanState();
  if (inFlight === null) {
    inFlight = readFromBilling().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Forces a read, used on every plan page load and plan change. */
export async function refreshPlanState(): Promise<PlanState> {
  lastReadAt = 0;
  return activePlanState();
}

export async function activePlan(): Promise<PlanName> {
  return (await activePlanState()).plan;
}

export interface Quota {
  readonly used: number;
  readonly limit: number | null;
  readonly resets_on: string;
}

/** Quota `used` is the number of moves to published in the current cycle. */
export async function quotaFor(state: PlanState): Promise<Quota> {
  const cycle = billingCycle(new Date(), state.billingCycleDay);
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM publish_events
     WHERE published_at >= $1`,
    [cycle.start],
  );
  return {
    used: Number(row?.n ?? '0'),
    limit: plan(state.plan).publishesPerCycle,
    resets_on: isoDate(cycle.resetsOn),
  };
}

export async function recordPublish(modelId: number): Promise<void> {
  await query(`INSERT INTO publish_events (model_id) VALUES ($1)`, [modelId]);
}
