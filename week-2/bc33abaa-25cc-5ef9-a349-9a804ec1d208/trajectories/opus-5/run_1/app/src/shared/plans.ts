export type PlanId = 'team' | 'business';
export type PeriodId = 'monthly' | 'annual';

export interface PlanOffer {
  plan: PlanId;
  period: PeriodId;
  killbillPlan: string;
  killbillSeatPlan: string;
  priceCents: number;
  includedSeats: number;
  extraSeatCents: number;
}

export const PLAN_NAMES: Record<PlanId, string> = { team: 'Team', business: 'Business' };
export const PERIOD_NAMES: Record<PeriodId, string> = { monthly: 'monthly', annual: 'annual' };
export const AGENT_TOKEN_LIMITS: Record<PlanId, number> = { team: 5, business: 25 };

export const PLAN_OFFERS: PlanOffer[] = [
  {
    plan: 'team',
    period: 'monthly',
    killbillPlan: 'team-monthly',
    killbillSeatPlan: 'seat-team-monthly',
    priceCents: 9600,
    includedSeats: 8,
    extraSeatCents: 1200,
  },
  {
    plan: 'team',
    period: 'annual',
    killbillPlan: 'team-annual',
    killbillSeatPlan: 'seat-team-annual',
    priceCents: 96000,
    includedSeats: 8,
    extraSeatCents: 12000,
  },
  {
    plan: 'business',
    period: 'monthly',
    killbillPlan: 'business-monthly',
    killbillSeatPlan: 'seat-business-monthly',
    priceCents: 38000,
    includedSeats: 20,
    extraSeatCents: 1600,
  },
  {
    plan: 'business',
    period: 'annual',
    killbillPlan: 'business-annual',
    killbillSeatPlan: 'seat-business-annual',
    priceCents: 380000,
    includedSeats: 20,
    extraSeatCents: 16000,
  },
];

export function planOffer(plan: PlanId, period: PeriodId): PlanOffer {
  const offer = PLAN_OFFERS.find((candidate) => candidate.plan === plan && candidate.period === period);
  if (!offer) throw new Error(`No offer for ${plan} ${period}`);
  return offer;
}

export const TRIAL_SEATS = 8;

/** A move to Business, or to annual within one plan, is an upgrade and bills at once. */
export function isUpgrade(
  from: { plan: PlanId; period: PeriodId },
  to: { plan: PlanId; period: PeriodId },
): boolean {
  if (from.plan === 'team' && to.plan === 'business') return true;
  if (from.plan === to.plan && from.period === 'monthly' && to.period === 'annual') return true;
  return false;
}
