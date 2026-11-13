/** The Archive plan: billing owns the money, the app owns the quota in bytes. */

import { DEFAULT_PLAN, planDefinition } from "../../shared/plans.js";
import type { Plan, PlanId } from "../../shared/model.js";
import { pool, type Queryable } from "../db/pool.js";
import { PLAN_LOCK, withAdvisoryLock } from "../db/locks.js";
import { applyPlan, readBilling } from "../services/billing.js";
import { conflict, DependencyDown } from "../errors.js";

export async function usedBytes(query: Queryable): Promise<number> {
  const result = await query.query<{ used: number }>(
    "select coalesce(sum(size_bytes), 0)::bigint as used from passes where state <> 'deleted'",
  );
  return result.rows[0].used;
}

export async function storedPlan(query: Queryable): Promise<PlanId> {
  const result = await query.query<{ plan: PlanId }>(
    "select plan from plan_state where id = 1",
  );
  return result.rows[0]?.plan ?? DEFAULT_PLAN;
}

async function setStoredPlan(plan: PlanId): Promise<void> {
  await pool.query(
    `insert into plan_state (id, plan, confirmed_ms) values (1, $1, $2)
     on conflict (id) do update set plan = $1, confirmed_ms = $2`,
    [plan, Date.now()],
  );
}

/** The quota of the last plan billing confirmed; it never waits on billing. */
export async function quotaBytes(query: Queryable): Promise<number> {
  return planDefinition(await storedPlan(query)).quota_bytes;
}

export async function readPlan(): Promise<Plan> {
  const used = await usedBytes(pool);
  try {
    const snapshot = await readBilling();
    const plan = snapshot.plan ?? DEFAULT_PLAN;
    if (plan !== (await storedPlan(pool))) {
      await setStoredPlan(plan);
    }
    const definition = planDefinition(plan);
    return {
      plan,
      label: definition.label,
      price_cents: definition.price_cents,
      period: definition.period,
      quota_bytes: definition.quota_bytes,
      used_bytes: used,
      next_billing_date: snapshot.nextBillingDate,
      balance_cents: snapshot.balanceCents,
      billing: "up",
    };
  } catch (error) {
    if (!(error instanceof DependencyDown)) {
      throw error;
    }
    const definition = planDefinition(await storedPlan(pool));
    return {
      plan: definition.plan,
      label: definition.label,
      price_cents: definition.price_cents,
      period: definition.period,
      quota_bytes: definition.quota_bytes,
      used_bytes: used,
      next_billing_date: null,
      balance_cents: null,
      billing: "down",
    };
  }
}

export async function changePlan(plan: PlanId): Promise<Plan> {
  return withAdvisoryLock(PLAN_LOCK, PLAN_LOCK, async () => {
    const current = await storedPlan(pool);
    if (current === plan) {
      return readPlan();
    }
    const definition = planDefinition(plan);
    const used = await usedBytes(pool);
    if (definition.quota_bytes < used) {
      throw conflict("plan_too_small", {
        quota_bytes: definition.quota_bytes,
        used_bytes: used,
      });
    }
    const snapshot = await applyPlan(plan);
    await setStoredPlan(plan);
    return {
      plan,
      label: definition.label,
      price_cents: definition.price_cents,
      period: definition.period,
      quota_bytes: definition.quota_bytes,
      used_bytes: await usedBytes(pool),
      next_billing_date: snapshot.nextBillingDate,
      balance_cents: snapshot.balanceCents,
      billing: "up",
    };
  });
}
