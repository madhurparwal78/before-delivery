import Decimal from 'decimal.js'

Decimal.set({ precision: 60, toExpNeg: -30, toExpPos: 60 })

export { Decimal }

export const TONNES_DP = 3
export const COVERAGE_DP = 1

/** Round half to even at dp decimals. */
export function roundHalfEven(value: Decimal, dp: number): Decimal {
  const shifted = value.times(Decimal.pow(10, dp))
  const floored = shifted.floor()
  const diff = shifted.minus(floored)
  let base: Decimal
  const half = new Decimal(0.5)
  if (diff.lessThan(half)) base = floored
  else if (diff.greaterThan(half)) base = floored.plus(1)
  else {
    // exactly half: to even
    if (floored.mod(2).isZero()) base = floored
    else base = floored.plus(1)
  }
  return base.div(Decimal.pow(10, dp))
}

/** Format a decimal at exactly dp decimals, half-even rounded, with leading '-' when negative, no sign otherwise. */
export function fmtTonnes(value: Decimal, dp = TONNES_DP): string {
  return roundHalfEven(value, dp).toFixed(dp)
}

/** Signed form: leading '+' when positive, '-' when negative, no sign for zero. */
export function fmtSigned(value: Decimal, dp = TONNES_DP): string {
  const s = fmtTonnes(value, dp)
  if (s.startsWith('-')) return s
  if (s === `0.${'0'.repeat(dp)}`) return s
  return `+${s}`
}

/** Percentages to one decimal, no % sign. */
export function fmtPct(value: Decimal): string {
  return roundHalfEven(value, COVERAGE_DP).toFixed(COVERAGE_DP)
}

/** Parse a numeric JSON value (not booleans) into Decimal; rejects NaN/Infinity. */
export function num(value: unknown): Decimal {
  return new Decimal(value as number)
}

export function int(value: Decimal): number {
  return value.trunc().toNumber()
}

export function divRound(value: Decimal, divisor: Decimal, dp: number): Decimal {
  return roundHalfEven(value.div(divisor), dp)
}
