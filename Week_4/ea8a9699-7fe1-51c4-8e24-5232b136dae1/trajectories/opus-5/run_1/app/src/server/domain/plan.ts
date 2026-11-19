import { one, query } from '../db.js';
import { planById } from '../../shared/plans.js';
import { readSubscriptionPlan } from '../services/killbill.js';
import type { WorkspaceRow } from '../auth.js';
import type { PlanId } from '../../shared/types.js';

export interface PlanState {
  plan: PlanId;
  seatCap: number;
}

/**
 * The one place that reads a workspace's plan. Kill Bill's active subscription decides; each
 * successful read is recorded, and while Kill Bill is unreachable the last record is used.
 */
export async function currentPlan(workspace: WorkspaceRow): Promise<PlanState> {
  try {
    const plan = await readSubscriptionPlan(workspace.slug);
    const definition = plan === null ? null : planById(plan);
    if (definition !== null && definition !== undefined) {
      await recordPlan(workspace.id, definition.plan, definition.seatCap);
      return { plan: definition.plan, seatCap: definition.seatCap };
    }
  } catch {
    // Billing is unreachable, so the last recorded plan and cap stand.
  }
  const row = await one<{ plan: PlanId; seat_cap: number }>('select plan, seat_cap from workspaces where id = $1', [
    workspace.id,
  ]);
  return { plan: row?.plan ?? workspace.plan, seatCap: row?.seat_cap ?? workspace.seat_cap };
}

export async function recordPlan(workspaceId: string, plan: PlanId, seatCap: number): Promise<void> {
  await query('update workspaces set plan = $2, seat_cap = $3 where id = $1', [workspaceId, plan, seatCap]);
}
