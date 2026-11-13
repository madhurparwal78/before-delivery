/** Monthly rate 1.25% is 1/80, so the instalment is exact in BigInt: P * 81^n / (80 * (81^n - 80^n)). */
export const EMI_TENURES = [3, 6, 9, 12] as const;
export type EmiTenure = (typeof EMI_TENURES)[number];
export const NO_COST_TENURES: readonly number[] = [3, 6];
export const MONTHLY_RATE_PERCENT = "1.25";

interface EmiPlan {
  tenureMonths: EmiTenure;
  noCost: boolean;
  upfrontDiscountPaise: number;
  principalPaise: number;
  instalmentPaise: number;
  totalInterestPaise: number;
  totalPayablePaise: number;
}

function instalment(principalPaise: number, months: number): number {
  const growth = 81n ** BigInt(months);
  const denominator = 80n * (growth - 80n ** BigInt(months));
  const numerator = BigInt(principalPaise) * growth;
  return Number((2n * numerator + denominator) / (2n * denominator));
}

export function emiPlan(amountPaise: number, tenureMonths: EmiTenure, noCostAllowed: boolean): EmiPlan {
  const noCost = noCostAllowed && NO_COST_TENURES.includes(tenureMonths);
  const upfrontDiscountPaise = noCost ? instalment(amountPaise, tenureMonths) * tenureMonths - amountPaise : 0;
  const principalPaise = amountPaise - upfrontDiscountPaise;
  const instalmentPaise = instalment(principalPaise, tenureMonths);
  const totalPayablePaise = instalmentPaise * tenureMonths;
  return {
    tenureMonths,
    noCost,
    upfrontDiscountPaise,
    principalPaise,
    instalmentPaise,
    totalInterestPaise: totalPayablePaise - principalPaise,
    totalPayablePaise,
  };
}
