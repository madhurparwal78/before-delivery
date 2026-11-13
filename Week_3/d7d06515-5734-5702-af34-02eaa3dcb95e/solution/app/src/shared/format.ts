// Number formatting of drawing values (brief: Business rules > Formats).
import type { Units } from './types.ts';

const MM_PER_M = 1000;

/** Rounds half away from zero to `places` decimals and prints without thousands separators ("-0.00" is never printed). */
function fixed(value: number, places: number): string {
  if (!Number.isFinite(value)) return String(value);
  // Work on the shortest decimal expansion of the double so 1.005 rounds as it reads, not as it is stored.
  const [mantissa = '0', exponent = '0'] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const keep = Number(exponent) + 1 + places;
  let scaled: bigint;
  if (keep >= digits.length) scaled = BigInt(digits) * 10n ** BigInt(keep - digits.length);
  else if (keep < 0) scaled = 0n;
  else {
    scaled = keep === 0 ? 0n : BigInt(digits.slice(0, keep));
    if ((digits[keep] ?? '0') >= '5') scaled += 1n;
  }
  const text = scaled.toString().padStart(places + 1, '0');
  const body = places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`;
  return value < 0 && scaled !== 0n ? `-${body}` : body;
}

/** Rounds half away from zero to 6 decimals, the precision of every number in the API. */
export function round6(value: number): number {
  const rounded = Math.round(Math.abs(value) * 1e6) / 1e6;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/** Lengths and coordinates: 2 decimals for mm, 3 for m. `mm` is in millimetres. */
export function formatLength(mm: number, units: Units): string {
  return units === 'm' ? fixed(mm / MM_PER_M, 3) : fixed(mm, 2);
}

/** Areas: `mm2` in square millimetres; mm² shows 2 decimals, m² shows 3. */
export function formatArea(mm2: number, units: Units): string {
  return units === 'm' ? fixed(mm2 / (MM_PER_M * MM_PER_M), 3) : fixed(mm2, 2);
}

/** Angles show 2 decimals and a degree sign, for example `90.00°`. */
export function formatAngle(degrees: number): string {
  return `${fixed(degrees, 2)}°`;
}

/** Typed distances and coordinates are read in the current units; converts to millimetres. */
export function unitsToMm(value: number, units: Units): number {
  return units === 'm' ? value * MM_PER_M : value;
}
