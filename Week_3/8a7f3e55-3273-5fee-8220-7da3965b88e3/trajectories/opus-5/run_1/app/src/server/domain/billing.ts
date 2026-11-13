import type { ContractRate } from '../../shared/api.js';

export interface ContractTerms {
  minimumMinutes: number;
  incrementMinutes: number;
  rotationIntervalMinutes: number;
}

/** The rate with the latest effective date on or before the booking's assignment date. */
export function rateInForce(
  rates: readonly ContractRate[],
  assignmentDate: string,
): ContractRate {
  const applicable = rates
    .filter((rate) => rate.effective_from <= assignmentDate)
    .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  const chosen = applicable[applicable.length - 1];
  if (!chosen) {
    throw new Error(`No contract rate in force on ${assignmentDate}`);
  }
  return chosen;
}

export function billableMinutes(basisMinutes: number, terms: ContractTerms): number {
  const rounded =
    Math.ceil(basisMinutes / terms.incrementMinutes) * terms.incrementMinutes;
  return Math.max(rounded, terms.minimumMinutes);
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

export interface LineArithmeticInput {
  rate: ContractRate;
  terms: ContractTerms;
  basisMinutes: number;
  interpreterCount: number;
  mileageMiles: number;
}

export interface LineArithmetic {
  billable_minutes: number;
  time_amount_cents: number;
  mileage_amount_cents: number;
  amount_cents: number;
}

/**
 * The whole money calculation for an invoice line, in integer cents, with the single
 * rounding step applied to the time amount and nothing else.
 */
export function computeLineAmounts(input: LineArithmeticInput): LineArithmetic {
  const minutes = billableMinutes(input.basisMinutes, input.terms);
  const surcharge = input.interpreterCount === 2 ? input.rate.team_surcharge_bp : 0;
  const numerator =
    BigInt(input.rate.hourly_rate_cents) *
    BigInt(minutes) *
    BigInt(input.interpreterCount) *
    BigInt(10_000 + surcharge);
  const denominator = 60n * 10_000n;
  const timeAmount = roundHalfUp(numerator, denominator);
  const mileageAmount = input.mileageMiles * input.rate.mileage_cents_per_mile;
  return {
    billable_minutes: minutes,
    time_amount_cents: timeAmount,
    mileage_amount_cents: mileageAmount,
    amount_cents: timeAmount + mileageAmount,
  };
}

export function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const grouped = whole.toLocaleString('en-US');
  return `${sign}$${grouped}.${fraction}`;
}
