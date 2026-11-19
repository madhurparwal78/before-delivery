import { mulHalf } from './int.ts';

const DECIMAL_IN = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;
const FEET_INCHES = /^(|[0-9]{1,3})(['\u2019]) (1[0-1]|[0-9])( ([1-9][0-9]?\/(2|4|8|16)))?(["\u201d])$/;

/**
 * Feet and inches: <feet><foot mark> <inches>[ <n>/<d>]<inch mark>, one ordinary space between
 * parts, marks straight or typographic. Returns null when malformed or not above zero.
 */
export function parseFeetInches(text: string): number | null {
  const m = FEET_INCHES.exec(text);
  if (!m) return null;
  const feet = m[1] === '' ? 0 : parseInt(m[1], 10);
  if (feet > 196) return null;
  const inches = parseInt(m[3]!, 10);
  const fr = m[4];
  let sixteenths = feet * 192 + inches * 16;
  if (fr) {
    const [ns, ds] = fr.slice(1).split('/');
    const n = parseInt(ns!, 10);
    const d = parseInt(ds!, 10);
    if (gcd(n, d) !== 1) return null; // the fraction must be in lowest terms
    sixteenths += (n * 16) / d;
  }
  if (sixteenths <= 0) return null;
  return mulHalf(sixteenths, 127, 80);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Parse `value_in` (decimal inches or feet and inches). Returns the mm value, or null when the
 * text is malformed or the total is not above zero. The 1..60000 range check is applied by callers.
 */
export function parseValueIn(text: string): number | null {
  if (typeof text !== 'string') return null;
  if (DECIMAL_IN.test(text)) {
    const h = parseDecimalInches(text);
    if (h === null || h <= 0) return null;
    return mulHalf(h, 254, 1000);
  }
  return parseFeetInches(text);
}

function parseDecimalInches(text: string): number | null {
  const m = DECIMAL_IN.exec(text);
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? '';
  return parseInt(whole, 10) * 100 + parseInt(frac.slice(1).padEnd(2, '0'), 10);
}

/** as_submitted for a value_in submission: feet-and-inches text stays exactly as typed. */
export function inchesAsSubmitted(text: string): string {
  return FEET_INCHES.test(text) ? text : `${text} in`;
}
