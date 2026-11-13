import type { DisplayUnit } from './types.js';

/**
 * Display formatting. One decision for how a whole-gram weight and a goal
 * delta are written in the hiker's display unit. The ounce figure is computed
 * with exact integer arithmetic and rounded half-up once, so a `.05` boundary
 * is never decided by binary floating point.
 */

/** Grams per ounce is 28.349523125; scaled by 10^9 that is 28349523125. */
const GRAMS_PER_OZ_SCALED = 283495231250n; // grams per ounce × 10^10
const SCALE = 10000000000n;

/** Ounces in tenths, rounded half-up once. */
function ouncesTenths(grams: number): bigint {
  const numerator = BigInt(grams) * 10n * SCALE;
  const denominator = GRAMS_PER_OZ_SCALED;
  // Half-up: floor((2n + d) / (2d)).
  return (2n * numerator + denominator) / (2n * denominator);
}

export function formatOunces(grams: number): string {
  const tenths = ouncesTenths(grams);
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return `${whole}.${fraction} oz`;
}

export function formatPoundsAndOunces(grams: number): string {
  const tenths = ouncesTenths(grams);
  const pounds = tenths / 160n;
  const ounceTenthsPart = tenths % 160n;
  const ounceWhole = ounceTenthsPart / 10n;
  const ounceFraction = ounceTenthsPart % 10n;
  return `${pounds} lb ${ounceWhole}.${ounceFraction} oz`;
}

export function formatWeight(grams: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'g':
      return `${grams} g`;
    case 'oz':
      return formatOunces(grams);
    case 'lb':
      return formatPoundsAndOunces(grams);
  }
}

/** The goal-delta text, converted once from the gram difference. */
export function goalDeltaText(goalGrams: number, baseGrams: number, unit: DisplayUnit): string {
  const difference = goalGrams >= baseGrams ? goalGrams - baseGrams : baseGrams - goalGrams;
  const direction = goalGrams >= baseGrams ? 'under goal' : 'over goal';
  return `${formatWeight(difference, unit)} ${direction}`;
}
