import { DECIMALS, type Currency } from './i18n'

export type RatesPpm = Record<Currency, number>

/** Converts per-night EUR amounts into `currency`; the total is rounded once and split so the nights add up exactly. */
export function convertNights(eurNights: readonly number[], ppm: number, currency: Currency): { total: number; split: number[] } {
  const denominator = 100n * 1000000n
  const exact = eurNights.map((amount) => BigInt(amount) * BigInt(ppm) * 10n ** BigInt(DECIMALS[currency]))
  const sum = exact.reduce((a, b) => a + b, 0n)
  const total = (2n * sum + denominator) / (2n * denominator)
  const parts = exact.map((value) => value / denominator)
  let missing = total - parts.reduce((a, b) => a + b, 0n)
  const order = exact.map((value, index) => ({ index, fraction: value % denominator })).sort((a, b) => (a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1))
  for (const { index } of order) {
    if (missing <= 0n) break
    parts[index] += 1n
    missing -= 1n
  }
  return { total: Number(total), split: parts.map(Number) }
}
