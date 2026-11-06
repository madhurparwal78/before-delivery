// Monthly financing terms (brief: Financing): exact fractions in BigInt, the last payment absorbing the rest.
import { roundHalfUp } from "../money.ts";

export interface FinancingTerm {
  months: number;
  apr_bp: number;
  monthly_cents: number;
  last_cents: number;
}

const MINIMUM_CENTS = 50000;
const RATE_DENOMINATOR = 120000;
const TERMS: [number, number][] = [[6, 0], [12, 0], [24, 999], [36, 999]];
const CANADA_TERMS: [number, number][] = [[12, 0], [24, 999]];

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** monthly = ceil(A × r / (1 − (1 + r)^−n)) with r = apr_bp / 120000, as A·p·(q+p)^n / (q·((q+p)^n − q^n)). */
function monthlyCents(amount: number, months: number, aprBp: number): number {
  if (aprBp === 0) return Number(ceilDiv(BigInt(amount), BigInt(months)));
  const p = BigInt(aprBp);
  const q = BigInt(RATE_DENOMINATOR);
  const grown = (q + p) ** BigInt(months);
  return Number(ceilDiv(BigInt(amount) * p * grown, q * (grown - q ** BigInt(months))));
}

function lastCents(amount: number, months: number, aprBp: number, monthly: number): number {
  const interest = (balance: number): number => roundHalfUp(balance * aprBp, RATE_DENOMINATOR);
  let balance = amount;
  for (let month = 1; month < months; month += 1) balance = balance + interest(balance) - monthly;
  return balance + interest(balance);
}

/** The terms offered on `amount` cents; Canada gets its own list, every other country and none the default. */
export function financing(amount: number, country: string | null): FinancingTerm[] {
  if (amount < MINIMUM_CENTS) return [];
  return (country === "CA" ? CANADA_TERMS : TERMS).map(([months, apr_bp]) => {
    const monthly_cents = monthlyCents(amount, months, apr_bp);
    return { months, apr_bp, monthly_cents, last_cents: lastCents(amount, months, apr_bp, monthly_cents) };
  });
}

/** The smallest monthly payment, or null when nothing is offered. */
export function asLowAs(amount: number): number | null {
  const terms = financing(amount, null);
  return terms.length ? Math.min(...terms.map((t) => t.monthly_cents)) : null;
}
