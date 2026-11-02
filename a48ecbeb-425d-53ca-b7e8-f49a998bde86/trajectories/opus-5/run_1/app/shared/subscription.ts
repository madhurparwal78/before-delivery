import { type Cadence, findPlan } from './catalogue.js';
import { addMonths, billingDayStart } from './time.js';

export type SubscriptionState = 'active' | 'paused' | 'past_due' | 'cancel_pending' | 'cancelled';

export type ChangeKind = 'pause' | 'resume' | 'skip' | 'swap' | 'cancel';

export type ChangeStatus = 'pending_provider' | 'applied' | 'rejected';

const MONTHS_PER_CYCLE: Readonly<Record<Cadence, number>> = {
  monthly: 1,
  bimonthly: 2,
};

/** Everything the change rules need to know about a subscription, read from Kill Bill. */
export interface SubscriptionFacts {
  readonly state: SubscriptionState;
  readonly plan: string;
  readonly cadence: Cadence;
  readonly nextRenewalDate: string | null;
  /** A pause that has not yet started. */
  readonly pauseScheduled: boolean;
  /** A skip that has not yet been consumed. */
  readonly skipScheduled: boolean;
}

export type ChangeRequest =
  | { kind: 'pause'; cycles: number }
  | { kind: 'resume' }
  | { kind: 'skip' }
  | { kind: 'swap'; plan: string }
  | { kind: 'cancel' };

/** The single decision on whether a change fits the subscription's state. */
export function isChangeLegal(facts: SubscriptionFacts, request: ChangeRequest): boolean {
  if (facts.state === 'cancel_pending' || facts.state === 'cancelled') return false;
  if (facts.state === 'past_due') return request.kind === 'cancel';
  switch (request.kind) {
    case 'pause':
      return facts.state === 'active' && !facts.pauseScheduled;
    case 'resume':
      return facts.state === 'paused' || facts.pauseScheduled;
    case 'skip':
      return facts.state === 'active' && !facts.pauseScheduled && !facts.skipScheduled;
    case 'swap':
      return request.plan !== facts.plan;
    case 'cancel':
      return true;
  }
}

export type SwapProblem = 'unknown_plan' | 'different_cadence' | null;

export function swapProblem(facts: SubscriptionFacts, planName: string): SwapProblem {
  const plan = findPlan(planName);
  if (!plan) return 'unknown_plan';
  if (plan.cadence !== facts.cadence) return 'different_cadence';
  return null;
}

/** Midnight at the start of the next renewal date, less the cutoff window. */
export function changeCutoffInstant(nextRenewalDate: string, cutoffHours: number): Date {
  return new Date(billingDayStart(nextRenewalDate).getTime() - cutoffHours * 3_600_000);
}

/** The date the next pause, skip or swap would start. */
export function changesApplyTo(
  nextRenewalDate: string,
  cadence: Cadence,
  cutoffHours: number,
  now: Date,
): string {
  const cutoff = changeCutoffInstant(nextRenewalDate, cutoffHours);
  if (now.getTime() < cutoff.getTime()) return nextRenewalDate;
  return addMonths(nextRenewalDate, MONTHS_PER_CYCLE[cadence]);
}

export function addCycles(date: string, cadence: Cadence, cycles: number): string {
  return addMonths(date, MONTHS_PER_CYCLE[cadence] * cycles);
}

export interface DunningStepDef {
  readonly step: DunningStepName;
  readonly day: number;
}

export type DunningStepName =
  | 'failed'
  | 'retry_1'
  | 'retry_2'
  | 'retry_3'
  | 'held'
  | 'cancelled';

export const DUNNING_SCHEDULE: readonly DunningStepDef[] = [
  { step: 'failed', day: 0 },
  { step: 'retry_1', day: 1 },
  { step: 'retry_2', day: 3 },
  { step: 'retry_3', day: 7 },
  { step: 'held', day: 8 },
  { step: 'cancelled', day: 14 },
];

/** The instant a dunning step is due, counted from the recorded failure. */
export function dunningStepDueAt(
  failedAt: Date,
  step: DunningStepName,
  dunningDaySeconds: number,
): Date {
  const found = DUNNING_SCHEDULE.find((entry) => entry.step === step);
  if (!found) throw new Error(`unknown dunning step ${step}`);
  return new Date(failedAt.getTime() + found.day * dunningDaySeconds * 1000);
}

export function nextDunningStep(step: DunningStepName): DunningStepName | null {
  const index = DUNNING_SCHEDULE.findIndex((entry) => entry.step === step);
  return DUNNING_SCHEDULE[index + 1]?.step ?? null;
}

export function isRetryStep(step: DunningStepName): step is 'retry_1' | 'retry_2' | 'retry_3' {
  return step === 'retry_1' || step === 'retry_2' || step === 'retry_3';
}

export function retryNumber(step: 'retry_1' | 'retry_2' | 'retry_3'): 1 | 2 | 3 {
  return step === 'retry_1' ? 1 : step === 'retry_2' ? 2 : 3;
}
