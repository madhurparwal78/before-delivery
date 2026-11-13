import { bigToInt, decimalText } from './numbers'

export type WeightUnit = 'g' | 'oz' | 'lb' | 'kg'

export const MAX_WEIGHT_GRAMS = 50000
export const GRAMS_PER_OUNCE = { numerator: 28349523125n, denominator: 1000000000n }

const FACTORS: Record<WeightUnit, { numerator: bigint; denominator: bigint }> = {
  g: { numerator: 1n, denominator: 1n },
  kg: { numerator: 1000n, denominator: 1n },
  oz: GRAMS_PER_OUNCE,
  lb: { numerator: 45359237n, denominator: 100000n },
}

/** a / b rounded half-up, for non-negative integers. */
export function divideHalfUp(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b)
}

/** Whole grams from a decimal exactly as written, converted once and rounded half-up. */
export function gramsFromDecimal(written: string, unit: WeightUnit): number | null {
  const digits = decimalText(written)
  if (digits === null) return null
  const [whole, fraction = ''] = digits.split('.')
  const scaled = BigInt(whole + fraction)
  const factor = FACTORS[unit]
  const grams = divideHalfUp(scaled * factor.numerator, 10n ** BigInt(fraction.length) * factor.denominator)
  return grams > 10n ** 12n ? null : bigToInt(grams)
}

/**
 * Entry rules for a typed weight: grams are whole, ounces carry up to two decimals,
 * and the converted result must sit between the given bounds (both allowed).
 */
export function entryGrams(value: unknown, unit: unknown, minimum: number): number | null {
  const written = decimalText(value)
  if (written === null || (unit !== 'g' && unit !== 'oz')) return null
  const decimals = written.includes('.') ? written.length - written.indexOf('.') - 1 : 0
  if (unit === 'g' ? decimals > 0 : decimals > 2) return null
  const grams = gramsFromDecimal(written, unit)
  return grams !== null && grams >= minimum && grams <= MAX_WEIGHT_GRAMS ? grams : null
}
