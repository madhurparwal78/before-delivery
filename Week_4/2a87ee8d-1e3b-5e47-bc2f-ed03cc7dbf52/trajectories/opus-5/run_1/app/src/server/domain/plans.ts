export const PLAN_CODES = ['free', 'studio', 'agency'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const BILLING_TERMS = ['monthly', 'annual'] as const;
export type BillingTerm = (typeof BILLING_TERMS)[number];

export type BillingState = 'active' | 'past_due' | 'read_only';

export interface Entitlements {
  readonly activeWorkshops: number | null;
  readonly participantsPerWorkshop: number | null;
  readonly silentRoundsPerWorkshop: number | null;
  readonly invitesPerDay: number | null;
  readonly recapScale: 1 | 2;
}

/** The one place the entitlement table lives. */
const ENTITLEMENTS: Readonly<Record<PlanCode, Entitlements>> = {
  free: {
    activeWorkshops: 3,
    participantsPerWorkshop: 8,
    silentRoundsPerWorkshop: 1,
    invitesPerDay: 20,
    recapScale: 1,
  },
  studio: {
    activeWorkshops: 20,
    participantsPerWorkshop: 30,
    silentRoundsPerWorkshop: null,
    invitesPerDay: 200,
    recapScale: 2,
  },
  agency: {
    activeWorkshops: null,
    participantsPerWorkshop: 50,
    silentRoundsPerWorkshop: null,
    invitesPerDay: 1000,
    recapScale: 2,
  },
};

/** Prices in exact decimal strings, euros. `null` means the term does not exist for the plan. */
const PRICES: Readonly<Record<PlanCode, Readonly<Record<BillingTerm, string | null>>>> = {
  free: { monthly: '0.00', annual: null },
  studio: { monthly: '24.00', annual: '230.40' },
  agency: { monthly: '59.00', annual: '566.40' },
};

const PLAN_LABELS: Readonly<Record<PlanCode, string>> = { free: 'Free', studio: 'Studio', agency: 'Agency' };
const PLAN_RANKS: Readonly<Record<PlanCode, number>> = { free: 0, studio: 1, agency: 2 };

export function entitlementsFor(plan: PlanCode): Entitlements {
  return ENTITLEMENTS[plan];
}

export function priceFor(plan: PlanCode, term: BillingTerm): string | null {
  return PRICES[plan][term];
}

function planLabel(plan: PlanCode): string {
  return PLAN_LABELS[plan];
}

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (PLAN_CODES as readonly string[]).includes(value);
}

export function isBillingTerm(value: unknown): value is BillingTerm {
  return typeof value === 'string' && (BILLING_TERMS as readonly string[]).includes(value);
}

export function killbillPlanName(plan: PlanCode, term: BillingTerm): string {
  return `${plan}-${term}`;
}

export type PlanChangePolicy = 'immediate' | 'scheduled' | 'unchanged' | 'cancel_pending';

/**
 * The one place the plan-change policy is decided. A change is immediate when the target
 * rank is higher, or when the rank is the same and the term goes monthly to annual.
 */
export function planChangePolicy(
  current: { plan: PlanCode; term: BillingTerm },
  target: { plan: PlanCode; term: BillingTerm },
  hasPendingChange: boolean,
): PlanChangePolicy {
  if (current.plan === target.plan && current.term === target.term) {
    return hasPendingChange ? 'cancel_pending' : 'unchanged';
  }
  const currentRank = PLAN_RANKS[current.plan];
  const targetRank = PLAN_RANKS[target.plan];
  if (targetRank > currentRank) return 'immediate';
  if (targetRank === currentRank && current.term === 'monthly' && target.term === 'annual') return 'immediate';
  return 'scheduled';
}

/** `resource` wording for the `plan_limit` message. */
export type LimitedResource = 'active workshops' | 'silent rounds per workshop';

export function planLimitMessage(plan: PlanCode, limit: number, resource: LimitedResource): string {
  return `Your ${planLabel(plan)} plan allows ${limit} ${resource}`;
}
