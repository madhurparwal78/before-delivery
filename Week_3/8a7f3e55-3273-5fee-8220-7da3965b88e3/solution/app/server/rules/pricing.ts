export interface ContractTerms {
  minimum_minutes: number;
  increment_minutes: number;
}

export interface RateRow {
  effective_from: string;
  hourly_rate_cents: number;
  team_surcharge_bp: number;
  mileage_cents_per_mile: number;
}

/** The rate with the latest effective date on or before the booking's agency-local start date. */
export function selectRate(rates: readonly RateRow[], assignmentDate: string): RateRow {
  const inForce = rates.filter((rate) => rate.effective_from <= assignmentDate);
  const latest = inForce.reduce<RateRow | null>((best, rate) => (best === null || rate.effective_from > best.effective_from ? rate : best), null);
  if (latest === null) throw new Error(`no contract rate in force on ${assignmentDate}`);
  return latest;
}

export interface LineArithmetic {
  basis_minutes: number;
  billable_minutes: number;
  interpreter_count: number;
  time_amount_cents: number;
  mileage_miles: number;
  mileage_amount_cents: number;
  amount_cents: number;
}

/** A completion bills the greater of the scheduled length and the minutes worked. */
export const completionBasisMinutes = (scheduledMinutes: number, workedMinutes: number): number => Math.max(scheduledMinutes, workedMinutes);

/** Billable minutes: the basis rounded up to the contract increment, never under the contract minimum. */
const billableMinutes = (terms: ContractTerms, basisMinutes: number): number =>
  Math.max(Math.ceil(basisMinutes / terms.increment_minutes) * terms.increment_minutes, terms.minimum_minutes);

/** One invoice line in integer cents, with a single rounding step (exact halves round up). */
export function computeLine(
  terms: ContractTerms,
  rate: RateRow,
  basisMinutes: number,
  interpreterCount: number,
  mileageMiles: number,
): LineArithmetic {
  const billable = billableMinutes(terms, basisMinutes);
  const surchargeBp = interpreterCount === 2 ? rate.team_surcharge_bp : 0;
  const numerator = BigInt(rate.hourly_rate_cents) * BigInt(billable) * BigInt(interpreterCount) * BigInt(10_000 + surchargeBp);
  const denominator = 60n * 10_000n;
  const timeAmount = Number((2n * numerator + denominator) / (2n * denominator));
  const mileageAmount = mileageMiles * rate.mileage_cents_per_mile;
  return {
    basis_minutes: basisMinutes,
    billable_minutes: billable,
    interpreter_count: interpreterCount,
    time_amount_cents: timeAmount,
    mileage_miles: mileageMiles,
    mileage_amount_cents: mileageAmount,
    amount_cents: timeAmount + mileageAmount,
  };
}
