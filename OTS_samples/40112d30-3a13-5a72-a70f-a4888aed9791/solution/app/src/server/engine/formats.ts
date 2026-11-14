import {
  addDecimals, compareDecimals, divideDecimals, exactDecimal, fixedDecimal, formatDecimal, integerDecimal,
  parseDecimal, ZERO,
} from './decimal.ts';

/** Normalises a decimal ("3.50" becomes "3.5", "-0.0" becomes "0"); text that is not a decimal comes back as it is. */
export function numberText(text: string): string {
  const value = parseDecimal(text);
  return value === null ? text : formatDecimal(value);
}

/** Exact comparison of two decimals written as text: -1, 0 or 1. */
export function compareDecimalText(a: string, b: string): number {
  return compareDecimals(exactDecimal(a), exactDecimal(b));
}

/** The decimal rounded half away from zero and shown with exactly `places` decimals. */
export function roundHalfAway(text: string, places: number): string {
  return fixedDecimal(exactDecimal(text), places);
}

/** The exact mean of one or more decimals, rounded half away from zero to `places` decimals. */
export function averageText(values: string[], places: number): string {
  const sum = values.reduce((total, value) => addDecimals(total, exactDecimal(value)), ZERO);
  return fixedDecimal(divideDecimals(sum, integerDecimal(values.length), places), places);
}

/** `count` of `of` as a percentage with one decimal; 0 of 0 is "0.0%". */
export function percentText(count: number, of: number): string {
  if (of === 0) return '0.0%';
  return `${fixedDecimal(divideDecimals(integerDecimal(count * 100), integerDecimal(of), 1), 1)}%`;
}
