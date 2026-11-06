// The payment split (DP-12). Parts always add up to the amount charged.
import { roundDiv } from "./money.js";

export interface SplitInputs {
  amount: number;
  baseRent: number;
  waiver: number;
  taxRateBp: number;
}

export interface Split {
  base: number;
  waiver: number;
  tax: number;
}

export function splitPayment({ amount, baseRent, waiver, taxRateBp }: SplitInputs): Split {
  const w = waiver;
  const t = roundDiv((baseRent + waiver) * taxRateBp, 10000);
  const T = baseRent + w + t;
  const taxPart = roundDiv(amount * t, T);
  const waiverPart = roundDiv(amount * w, T);
  const basePart = amount - taxPart - waiverPart;
  return { base: basePart, waiver: waiverPart, tax: taxPart };
}

// Sales tax for the monthly invoice line.
export function invoiceTax(baseRent: number, waiver: number, taxRateBp: number): number {
  return roundDiv((baseRent + waiver) * taxRateBp, 10000);
}
