import { DOWNGRADED_OVERDUE_STATE, WARNING_OVERDUE_STATE } from '../providers/killbill.js';
import { PLAN_RATES } from '../providers/valkey.js';
import type { BillingState, Plan } from './types.js';

export const PLANS: readonly Plan[] = ['sandbox', 'builder', 'desk'];
export const PLAN_LABELS: Record<Plan, string> = {
  sandbox: 'Sandbox',
  builder: 'Builder',
  desk: 'Desk',
};
const PLAN_RANK: Record<Plan, number> = { sandbox: 0, builder: 1, desk: 2 };

export const isUpgrade = (from: Plan, to: Plan): boolean => PLAN_RANK[to] > PLAN_RANK[from];

/** The one mapping from Kill Bill's overdue state to the builder's plan state. */
export function planStateFromOverdue(overdueState: string): BillingState {
  if (overdueState === DOWNGRADED_OVERDUE_STATE) return 'downgraded';
  if (overdueState === WARNING_OVERDUE_STATE) return 'payment_failed';
  return 'active';
}

/** While downgraded the effective plan is Sandbox. */
export const effectivePlan = (plan: Plan, state: BillingState): Plan =>
  state === 'downgraded' ? 'sandbox' : plan;

export const rateFor = (plan: Plan): number => PLAN_RATES[plan];
