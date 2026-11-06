import { divCeil, ipow, roundHalfUp } from '../money.js';

export interface FinancingTerm {
  months: number;
  apr_bp: number;
  monthly_cents: number;
  last_cents: number;
}

const DEFAULT_TERMS: readonly { months: number; apr_bp: number }[] = [
  { months: 6, apr_bp: 0 },
  { months: 12, apr_bp: 0 },
  { months: 24, apr_bp: 999 },
  { months: 36, apr_bp: 999 },
];

const CANADA_TERMS: readonly { months: number; apr_bp: number }[] = [
  { months: 12, apr_bp: 0 },
  { months: 24, apr_bp: 999 },
];

const MINIMUM_FINANCED_CENTS = 50000;
const RATE_DENOMINATOR = 120000n;

function monthlyCents(amount: bigint, months: number, aprBp: number): bigint {
  if (aprBp === 0) return divCeil(amount, BigInt(months));
  const p = BigInt(aprBp);
  const q = RATE_DENOMINATOR;
  const grown = ipow(q + p, months);
  const plain = ipow(q, months);
  return divCeil(amount * p * grown, q * (grown - plain));
}

function lastCents(amount: bigint, months: number, aprBp: number, monthly: bigint): bigint {
  let balance = amount;
  const p = BigInt(aprBp);
  for (let i = 0; i < months - 1; i += 1) {
    const interest = aprBp === 0 ? 0n : roundHalfUp(balance * p, RATE_DENOMINATOR);
    balance = balance + interest - monthly;
  }
  const finalInterest = aprBp === 0 ? 0n : roundHalfUp(balance * p, RATE_DENOMINATOR);
  return balance + finalInterest;
}

/** The financing terms offered for an amount in a country. */
export function financingFor(amountCents: number, country?: string | null): FinancingTerm[] {
  if (amountCents < MINIMUM_FINANCED_CENTS) return [];
  const table = country === 'CA' ? CANADA_TERMS : DEFAULT_TERMS;
  const amount = BigInt(amountCents);
  return table.map(({ months, apr_bp }) => {
    const monthly = monthlyCents(amount, months, apr_bp);
    return {
      months,
      apr_bp,
      monthly_cents: Number(monthly),
      last_cents: Number(lastCents(amount, months, apr_bp, monthly)),
    };
  });
}

export function asLowAsCents(amountCents: number, country?: string | null): number | null {
  const terms = financingFor(amountCents, country);
  if (terms.length === 0) return null;
  return Math.min(...terms.map((t) => t.monthly_cents));
}
