import type { VestingType } from "./types.js";

export const MARKS = 48;
export const CLIFF_MONTHS = 12;

/** The month marks a ribbon draws, one per cell: a standard grant's cliff cell is labelled with mark 12. */
export function cellMarks(vestingType: VestingType): number[] {
  return vestingType === "standard"
    ? [CLIFF_MONTHS, ...Array.from({ length: MARKS - CLIFF_MONTHS }, (_, index) => CLIFF_MONTHS + 1 + index)]
    : Array.from({ length: MARKS }, (_, index) => index + 1);
}

/** The cell whose marks include `month` (month 0 uses the first cell). */
export function cellIndexOf(vestingType: VestingType, month: number): number {
  return vestingType === "standard" ? (month <= CLIFF_MONTHS ? 0 : month - CLIFF_MONTHS) : Math.max(0, month - 1);
}
