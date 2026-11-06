/**
 * Display formatting. Units change display strings only and never a verdict,
 * so every conversion here starts from the stored integer tenths or cents and
 * rounds half up with integer arithmetic.
 */

import type { Units } from './types.js';

/** Round `num / den` half up, for non-negative integers. */
function divRoundHalfUp(num: bigint, den: bigint): bigint {
  const q = num / den;
  const rem = num - q * den;
  return rem * 2n >= den ? q + 1n : q;
}

function fixedFromScaled(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  const frac = abs - whole * unit;
  const body =
    decimals === 0
      ? whole.toString()
      : `${whole.toString()}.${frac.toString().padStart(decimals, '0')}`;
  return negative ? `-${body}` : body;
}

/** An integer in tenths as a bare one-decimal string, e.g. `3.0`. */
export function tenthsToOneDecimalString(tenths: number): string {
  return fixedFromScaled(BigInt(tenths), 1);
}

/** Tenths of a millimetre as a one-decimal millimetre string, e.g. `3.0`. */
export function tenthsMmToMmString(tenths: number): string {
  return tenthsToOneDecimalString(tenths);
}

/** Millimetres are inches ÷ 25.4 exactly, shown to three decimals half up. */
export function tenthsMmToInchString(tenths: number): string {
  const negative = tenths < 0;
  const abs = BigInt(Math.abs(tenths));
  const thousandths = divRoundHalfUp(abs * 1000n, 254n);
  const body = fixedFromScaled(thousandths, 3);
  return negative ? `-${body}` : body;
}

/** A length for display, e.g. `3.0 mm` or `0.118 in`. */
export function formatLength(tenthsMm: number, units: Units): string {
  return units === 'imperial'
    ? `${tenthsMmToInchString(tenthsMm)} in`
    : `${tenthsMmToMmString(tenthsMm)} mm`;
}

/** Pounds are kilograms ÷ 0.45359237, shown to one decimal half up. */
export function tenthsKgToPoundString(tenths: number): string {
  const negative = tenths < 0;
  const abs = BigInt(Math.abs(tenths));
  const lbTenths = divRoundHalfUp(abs * 100_000_000n, 45_359_237n);
  const body = fixedFromScaled(lbTenths, 1);
  return negative ? `-${body}` : body;
}

/** A mass for display, e.g. `86.0 kg` or `189.6 lb`. */
export function formatMass(tenthsKg: number, units: Units): string {
  return units === 'imperial'
    ? `${tenthsKgToPoundString(tenthsKg)} lb`
    : `${fixedFromScaled(BigInt(tenthsKg), 1)} kg`;
}

/** Integer cents as `€1,495.00`. */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = abs - whole * 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}€${grouped}.${frac.toString().padStart(2, '0')}`;
}

/** Tenths of a percentage point as a one-decimal string, e.g. `10.0`. */
export function tenthsPctToString(tenths: number): string {
  return fixedFromScaled(BigInt(tenths), 1);
}

/** Tenths of a kilowatt as a one-decimal string, e.g. `1.0`. */
export function tenthsKwToString(tenths: number): string {
  return fixedFromScaled(BigInt(tenths), 1);
}

export { divRoundHalfUp, fixedFromScaled };
