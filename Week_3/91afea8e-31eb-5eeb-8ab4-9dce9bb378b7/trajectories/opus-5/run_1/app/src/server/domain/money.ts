/** Integer paise arithmetic. Every "rounded" value in the brief is decided here. */

/** Half up to the nearest whole paisa, applied once. */
export function roundDiv(numerator: number, denominator: number): number {
  if (numerator < 0) return -roundDiv(-numerator, denominator);
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function roundDivBig(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n) return -roundDivBig(-numerator, denominator);
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/** Percent of an amount, rounded half up. `percent` may be fractional. */
export function percentOf(amountPaise: number, percent: number): number {
  const scaledPercent = Math.round(percent * 1000);
  return roundDiv(amountPaise * scaledPercent, 100_000);
}

export type TaxSplit = {
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
};

/** GST-inclusive total split into taxable value and CGST+SGST or IGST. */
export function taxSplit(lineTotalPaise: number, gstRate: number, intraState: boolean): TaxSplit {
  const scaledRate = Math.round(gstRate * 100);
  const taxable = roundDiv(lineTotalPaise * 10_000, 10_000 + scaledRate);
  const tax = lineTotalPaise - taxable;
  if (intraState) {
    const sgst = Math.floor(tax / 2);
    return {
      taxable_value_paise: taxable,
      cgst_paise: tax - sgst,
      sgst_paise: sgst,
      igst_paise: 0,
    };
  }
  return { taxable_value_paise: taxable, cgst_paise: 0, sgst_paise: 0, igst_paise: tax };
}

/**
 * Spreads `total` across `weights` by largest remainder. Shares add up exactly to `total`.
 * Ties go to the earlier entry, so the caller passes weights in cart order.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0 || total === 0) return weights.map(() => 0);
  const shares: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let assigned = 0;
  weights.forEach((weight, index) => {
    const exact = total * weight;
    const share = Math.floor(exact / weightSum);
    shares.push(share);
    assigned += share;
    remainders.push({ index, remainder: exact - share * weightSum });
  });
  let leftover = total - assigned;
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let cursor = 0;
  while (leftover > 0 && remainders.length > 0) {
    shares[remainders[cursor % remainders.length].index] += 1;
    leftover -= 1;
    cursor += 1;
  }
  return shares;
}

export const FREE_DELIVERY_THRESHOLD_PAISE = 49_900;
export const STANDARD_DELIVERY_FEE_PAISE = 4_000;
export const ONE_DAY_DELIVERY_FEE_PAISE = 9_900;
export const GIFT_WRAP_FEE_PAISE = 3_000;
export const COD_FEE_PAISE = 2_500;
export const COD_CAP_PAISE = 5_000_000;
export const EMI_MINIMUM_PAISE = 300_000;

export function standardDeliveryFee(parcelSubtotalPaise: number): number {
  return parcelSubtotalPaise >= FREE_DELIVERY_THRESHOLD_PAISE ? 0 : STANDARD_DELIVERY_FEE_PAISE;
}

export function deliveryFee(parcelSubtotalPaise: number, oneDay: boolean): number {
  return oneDay ? ONE_DAY_DELIVERY_FEE_PAISE : standardDeliveryFee(parcelSubtotalPaise);
}

/**
 * Prorated share of a line total for `units` of `quantity`, half up.
 * The last unrefunded units take the exact remainder.
 */
export function proratedShare(
  lineTotalPaise: number,
  quantity: number,
  units: number,
  alreadyRefundedPaise: number,
  alreadyRefundedUnits: number,
): number {
  if (alreadyRefundedUnits + units >= quantity) {
    return lineTotalPaise - alreadyRefundedPaise;
  }
  return roundDiv(lineTotalPaise * units, quantity);
}
