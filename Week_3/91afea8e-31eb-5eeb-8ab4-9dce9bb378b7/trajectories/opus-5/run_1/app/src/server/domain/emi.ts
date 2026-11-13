/** Card EMI plans. The monthly rate is 1.25%, held exactly as 1/80. */

import type { EmiPlan, EmiPlansResponse } from '../../shared/types.js';
import { EMI_MINIMUM_PAISE, roundDivBig } from './money.js';

export const MONTHLY_RATE_PERCENT = '1.25';
export const EMI_TENURES = [3, 6, 9, 12] as const;
const NO_COST_TENURES = new Set<number>([3, 6]);

function instalment(principalPaise: number, tenureMonths: number): number {
  const grown = 81n ** BigInt(tenureMonths);
  const base = 80n ** BigInt(tenureMonths);
  return roundDivBig(BigInt(principalPaise) * grown, 80n * (grown - base));
}

function standardPlan(principalPaise: number, tenureMonths: number): EmiPlan {
  const monthly = instalment(principalPaise, tenureMonths);
  const totalPayable = monthly * tenureMonths;
  return {
    tenure_months: tenureMonths,
    no_cost: false,
    upfront_discount_paise: 0,
    principal_paise: principalPaise,
    instalment_paise: monthly,
    total_interest_paise: totalPayable - principalPaise,
    total_payable_paise: totalPayable,
  };
}

function noCostPlan(amountPaise: number, tenureMonths: number): EmiPlan {
  const discount = standardPlan(amountPaise, tenureMonths).total_interest_paise;
  const principal = amountPaise - discount;
  const monthly = instalment(principal, tenureMonths);
  const totalPayable = monthly * tenureMonths;
  return {
    tenure_months: tenureMonths,
    no_cost: true,
    upfront_discount_paise: discount,
    principal_paise: principal,
    instalment_paise: monthly,
    total_interest_paise: totalPayable - principal,
    total_payable_paise: totalPayable,
  };
}

export function emiPlans(amountPaise: number, noCostAllowed: boolean): EmiPlansResponse {
  return {
    amount_paise: amountPaise,
    monthly_rate_percent: MONTHLY_RATE_PERCENT,
    plans: EMI_TENURES.map((tenure) =>
      noCostAllowed && NO_COST_TENURES.has(tenure)
        ? noCostPlan(amountPaise, tenure)
        : standardPlan(amountPaise, tenure),
    ),
  };
}

export function emiUpfrontDiscount(
  amountPaise: number,
  tenureMonths: number,
  noCostAllowed: boolean,
): number {
  if (!noCostAllowed || !NO_COST_TENURES.has(tenureMonths)) return 0;
  return standardPlan(amountPaise, tenureMonths).total_interest_paise;
}

export function emiAmountAllowed(amountPaise: number): boolean {
  return amountPaise >= EMI_MINIMUM_PAISE;
}
