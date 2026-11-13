/**
 * Decimal-exact weight arithmetic. Every weight the hiker types is a decimal
 * number as written; we parse its digits into a scaled integer instead of using
 * binary floating point, convert once by an exact integer multiplier, and
 * round half-up once to whole grams.
 *
 * The value's scale is 10^9 (nanograms), fine enough for every conversion
 * factor the rules use (28.349523125 g per oz has nine decimals).
 */

/** Exact conversion factors between units, as rational multipliers on the 10^9 scale. */
const G_PER_OZ = 28349523125n; // 28.349523125 g/oz × 10^9
const G_PER_LB = 453592370000n; // 453.59237 g/lb × 10^9
const G_PER_KG = 1000000000000n; // 1000 g/kg × 10^9
const SCALE = 1000000000n;

/** A parsed decimal as written: digits and the count of fraction digits. */
export interface DecimalAsWritten {
  readonly digits: string;
  readonly fractionDigits: number;
}

/**
 * Parses a decimal number exactly as written. Accepts `12`, `12.5`, `0.0125`.
 * Returns null for anything that is not a plain decimal number: signs,
 * exponents, leading points, commas, blanks and other characters are refused.
 */
export function parseDecimalAsWritten(value: string): DecimalAsWritten | null {
  const text = value.trim();
  if (text.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return { digits: whole + fraction, fractionDigits: fraction.length };
}

/** Scales the parsed decimal by 10^9: digits × 10^(9 − fractionDigits). */
function scaledByTenToNine(dec: DecimalAsWritten): bigint {
  const raw = BigInt(dec.digits);
  const shift = 9 - dec.fractionDigits;
  return shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
}

/** Rounds a scaled gram value to whole grams, half-up, once. */
function scaledToGramsHalfUp(scaledGrams: bigint): number {
  const half = SCALE / 2n;
  return Number((scaledGrams + half) / SCALE);
}

export type WeightInputUnit = 'g' | 'oz' | 'lb' | 'kg';

/**
 * Converts a weight value in the given unit into whole grams using the exact
 * decimal digits of the value, rounding half-up once. Returns null when the
 * value is not a plain decimal number or lands above 50000 g.
 */
export function convertToGrams(value: string, unit: WeightInputUnit): number | null {
  const dec = parseDecimalAsWritten(value);
  if (dec === null) return null;
  const scaled = scaledByTenToNine(dec);
  let scaledGrams: bigint;
  switch (unit) {
    case 'g':
      scaledGrams = scaled;
      break;
    case 'oz':
      scaledGrams = (scaled * G_PER_OZ) / SCALE;
      break;
    case 'lb':
      scaledGrams = (scaled * G_PER_LB) / SCALE;
      break;
    case 'kg':
      scaledGrams = (scaled * G_PER_KG) / SCALE;
      break;
  }
  // The limit is on the converted whole grams, so 50000.4 g passes (it rounds
  // to 50000) while 50000.5 g does not (it rounds to 50001).
  const grams = scaledToGramsHalfUp(scaledGrams);
  if (grams > 50000) return null;
  return grams;
}

/** Converts a numeric input once; the number must already be a plain decimal. */
export function convertNumberToGrams(value: number, unit: WeightInputUnit): number | null {
  return convertToGrams(value.toString(), unit);
}
