import type { Amount, Currency } from './money.js';
import { HttpError } from './util.js';

export type PlanId = 'launch-page' | 'studio-site' | 'care-lite' | 'care-plus';
export type CareTier = 'lite' | 'plus';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  kind: 'build' | 'care';
  careTier?: CareTier;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  'launch-page': { id: 'launch-page', name: 'Launch Page', kind: 'build' },
  'studio-site': { id: 'studio-site', name: 'Studio Site', kind: 'build' },
  'care-lite': { id: 'care-lite', name: 'Care Lite', kind: 'care', careTier: 'lite' },
  'care-plus': { id: 'care-plus', name: 'Care Plus', kind: 'care', careTier: 'plus' },
};

export function planCarePlanId(tier: CareTier): PlanId {
  return tier === 'lite' ? 'care-lite' : 'care-plus';
}

export function planCareTier(plan: PlanId): CareTier {
  return plan === 'care-lite' ? 'lite' : 'plus';
}

export function isCarePlan(plan: PlanId): boolean {
  return PLANS[plan].kind === 'care';
}

export function parsePlanId(value: string): PlanId {
  if (value === 'launch-page' || value === 'studio-site' || value === 'care-lite' || value === 'care-plus') {
    return value;
  }
  throw new HttpError(422, 'invalid_plan', 'Choose one of the published plans.', { plan: 'Choose one of the published plans.' });
}

export function parseCurrency(value: string): Currency {
  if (value === 'USD' || value === 'ARS') return value;
  throw new HttpError(422, 'invalid_currency', 'Choose USD or ARS.', { currency: 'Choose USD or ARS.' });
}

export function parseCareTier(value: string): CareTier {
  if (value === 'lite' || value === 'plus') return value;
  throw new HttpError(422, 'invalid_tier', 'Choose Care Lite or Care Plus.', { tier: 'Choose Care Lite or Care Plus.' });
}

/**
 * The one place that decides a build's deposit split: the deposit is 40% of the
 * total rounded down to the cent, the launch balance is the rest.
 */
export function splitDeposit(total: Amount): { dueNow: Amount; dueAtLaunch: Amount } {
  const dueNowMinor = (total.minor * 40n) / 100n;
  const dueNow: Amount = { currency: total.currency, minor: dueNowMinor };
  const dueAtLaunch: Amount = { currency: total.currency, minor: total.minor - dueNowMinor };
  return { dueNow, dueAtLaunch };
}

/** The quote figures for a price: builds split 40/60, care plans owe the first month in full. */
export function quoteFigures(plan: PlanId, price: Amount): { total: Amount; dueNow: Amount; dueAtLaunch: Amount } {
  if (isCarePlan(plan)) {
    return { total: price, dueNow: price, dueAtLaunch: { currency: price.currency, minor: 0n } };
  }
  const { dueNow, dueAtLaunch } = splitDeposit(price);
  return { total: price, dueNow, dueAtLaunch };
}

export type OrderState =
  | 'quoted'
  | 'accepted'
  | 'deposit_paid'
  | 'in_build'
  | 'balance_invoiced'
  | 'paid_in_full'
  | 'closed';

export const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  quoted: ['accepted'],
  accepted: ['deposit_paid', 'paid_in_full'],
  deposit_paid: ['in_build'],
  in_build: ['balance_invoiced'],
  balance_invoiced: ['paid_in_full'],
  paid_in_full: ['closed'],
  closed: [],
};

export function orderTransitionAllowed(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function invalidTransition(from: OrderState, to: OrderState): HttpError {
  return new HttpError(
    409,
    'invalid_transition',
    `This order is ${from.replace(/_/g, ' ')} and cannot move to ${to.replace(/_/g, ' ')}.`,
  );
}

export type PlanStatus = 'active' | 'paused' | 'pending_cancel' | 'past_due' | 'cancelled';

export type UserRole = 'client_owner' | 'teammate' | 'studio_owner' | 'contractor';
