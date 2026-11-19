import { roundHalfAway } from '../shared/units';

/**
 * The one place that reads an owner's figure off the tape, in either of the two
 * published forms, and the one place that decides the unit-slip guard.
 */

export const MIN_LENGTH_MM = 1;
export const MAX_LENGTH_MM = 60000;

export type InchParse =
  | { readonly ok: true; readonly mm: number; readonly asSubmitted: string }
  | { readonly ok: false; readonly problem: 'malformed' | 'out_of_range' };

const DECIMAL_INCHES = /^(\d+)(?:\.(\d{1,2}))?$/;
const FEET_AND_INCHES = /^(0|[1-9]\d*)['\u2019] (0|[1-9]\d*)(?: (\d+)\/(\d+))?["\u201d]$/;
const ALLOWED_DENOMINATORS = new Set([2, 4, 8, 16]);

function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function inRange(mm: number): boolean {
  return mm >= MIN_LENGTH_MM && mm <= MAX_LENGTH_MM;
}

/** Decimal inches: h hundredths of an inch become h × 254 ÷ 1000 mm. */
function parseDecimalInches(text: string): InchParse | null {
  const match = DECIMAL_INCHES.exec(text);
  if (!match) return null;
  const whole = match[1] as string;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const hundredths = BigInt(whole) * 100n + BigInt(fraction);
  if (hundredths <= 0n) return { ok: false, problem: 'malformed' };
  const mm = roundHalfAway(hundredths * 254n, 1000n);
  if (!inRange(mm)) return { ok: false, problem: 'out_of_range' };
  return { ok: true, mm, asSubmitted: `${text} in` };
}

/** Feet and inches: t sixteenths of an inch become t × 127 ÷ 80 mm. */
function parseFeetAndInches(text: string): InchParse | null {
  const match = FEET_AND_INCHES.exec(text);
  if (!match) return null;
  const feet = Number(match[1]);
  const wholeInches = Number(match[2]);
  if (feet > 196 || wholeInches > 11) return { ok: false, problem: 'malformed' };
  let sixteenths = (feet * 12 + wholeInches) * 16;
  if (match[3] !== undefined && match[4] !== undefined) {
    const numerator = Number(match[3]);
    const denominator = Number(match[4]);
    if (!ALLOWED_DENOMINATORS.has(denominator)) return { ok: false, problem: 'malformed' };
    if (numerator <= 0 || numerator >= denominator) return { ok: false, problem: 'malformed' };
    if (greatestCommonDivisor(numerator, denominator) !== 1) return { ok: false, problem: 'malformed' };
    sixteenths += (numerator * 16) / denominator;
  }
  if (sixteenths <= 0) return { ok: false, problem: 'malformed' };
  const mm = roundHalfAway(BigInt(sixteenths) * 127n, 80n);
  if (!inRange(mm)) return { ok: false, problem: 'out_of_range' };
  return { ok: true, mm, asSubmitted: text };
}

export function parseInchFigure(text: string): InchParse {
  const decimal = parseDecimalInches(text);
  if (decimal) return decimal;
  const feet = parseFeetAndInches(text);
  if (feet) return feet;
  return { ok: false, problem: 'malformed' };
}

export function asSubmittedMillimetres(valueMm: number): string {
  return `${valueMm} mm`;
}

/**
 * The unit-slip guard. A millimetre figure v is refused when reading it as
 * inches lands within the tolerance band of the dimension's current value c.
 * A dimension with no current value is never guarded.
 */
export function readsAsInches(valueMm: number, currentMm: number | null, toleranceMm: number): boolean {
  if (currentMm === null) return false;
  const asInches = roundHalfAway(BigInt(valueMm) * 254n, 10n);
  return Math.abs(asInches - currentMm) <= toleranceMm;
}
