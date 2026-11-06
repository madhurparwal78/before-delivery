import type { ClassCode } from "../../shared/api.js";

// Integer paise arithmetic. Rounding happens only where the brief names it, half up, once.

/** The integer nearest to numerator / denominator, ties away from zero (inputs are non-negative paise). */
export function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Kill Bill takes rupees: `1790.25`, written from integer paise without float arithmetic. */
export function rupees(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

const GST_PERCENT = 5;

/** GST is charged on AC classes only: 3A here. */
export function gstApplies(cls: ClassCode): boolean {
  return cls === "3A";
}

/** 5% GST on a charge, rounded half up to whole paise once (brief: GST on charges). */
export function gstOn(paise: number): number {
  return roundHalfUp(paise * GST_PERCENT, 100);
}
