import type { DisplayUnit } from './api-types'
import { bigToInt } from './numbers'
import { GRAMS_PER_OUNCE, divideHalfUp } from './weights'

/** Ounces in tenths: grams ÷ 28.349523125 rounded half-up, from whole grams. */
function ounceTenths(grams: number): bigint {
  return divideHalfUp(BigInt(grams) * 10n * GRAMS_PER_OUNCE.denominator, GRAMS_PER_OUNCE.numerator)
}

function tenthsText(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}`
}

/** One weight in the hiker's display unit; the pound figure is split after the ounces are rounded. */
export function formatWeight(grams: number, unit: DisplayUnit): string {
  if (unit === 'g') return `${grams} g`
  const tenths = ounceTenths(grams)
  if (unit === 'oz') return `${tenthsText(tenths)} oz`
  return `${tenths / 160n} lb ${tenthsText(tenths % 160n)} oz`
}

/** The goal delta, converted once from the gram difference. */
export function formatDelta(baseGrams: number, goalGrams: number, unit: DisplayUnit): string {
  return baseGrams <= goalGrams
    ? `${formatWeight(goalGrams - baseGrams, unit)} under goal`
    : `${formatWeight(baseGrams - goalGrams, unit)} over goal`
}

/** A figure as a share of a whole, as a rounded-half-up whole percent. */
export function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : bigToInt(divideHalfUp(BigInt(part) * 100n, BigInt(whole)))
}

/** Pixels for a weight on a column that stands for the goal. */
export function scaleToColumn(grams: number, columnPx: number, goalGrams: number): number {
  return bigToInt(divideHalfUp(BigInt(grams) * BigInt(columnPx), BigInt(goalGrams)))
}
