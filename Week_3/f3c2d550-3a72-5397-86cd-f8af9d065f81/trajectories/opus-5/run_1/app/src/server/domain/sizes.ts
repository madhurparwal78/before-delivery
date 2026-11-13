import type { SizeTenths, SizeText, Unit } from '../../shared/types.js';

/**
 * The single place where sizes convert between input, storage (whole tenths of a
 * millimetre) and display.
 */

export const MIN_TENTHS = 1;
export const MAX_TENTHS = 50000;

const MM_INPUT = /^[0-9]+(\.[0-9])?$/;
const IN_INPUT = /^[0-9]+(\.[0-9]{1,2})?$/;

/** Reads a decimal string with at most `places` decimals as an integer scaled by 10^places. */
function scaledInteger(raw: string, places: number): number {
  const [whole, fraction = ''] = raw.split('.');
  return Number(whole) * 10 ** places + Number((fraction + '0'.repeat(places)).slice(0, places));
}

/** Rounds `numerator / denominator` half up, for non-negative integers. */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Parses one size field. Returns whole tenths of a millimetre, or null when invalid. */
export function parseSizeToTenths(raw: string, unit: Unit): number | null {
  const text = raw.trim();
  if (unit === 'mm') {
    if (!MM_INPUT.test(text)) return null;
    const tenths = scaledInteger(text, 1);
    return inRange(tenths);
  }
  if (!IN_INPUT.test(text)) return null;
  const hundredthsOfAnInch = scaledInteger(text, 2);
  // tenths of a millimetre = inches x 254, rounded half up.
  const tenths = roundHalfUp(hundredthsOfAnInch * 254, 100);
  return inRange(tenths);
}

function inRange(tenths: number): number | null {
  return tenths >= MIN_TENTHS && tenths <= MAX_TENTHS ? tenths : null;
}

/** One stored size as shown in a unit, always to one decimal place. */
export function tenthsToText(tenths: number, unit: Unit): string {
  if (unit === 'mm') {
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const inchTenths = roundHalfUp(tenths * 10, 254);
  return `${Math.floor(inchTenths / 10)}.${inchTenths % 10}`;
}

/** `<width> × <height> × <depth> <unit>`. */
export function sizeLine(size: SizeTenths, unit: Unit): string {
  const parts = [size.width, size.height, size.depth].map((t) => tenthsToText(t, unit));
  return `${parts.join(' × ')} ${unit}`;
}

export function sizeText(size: SizeTenths): SizeText {
  return { mm: sizeLine(size, 'mm'), in: sizeLine(size, 'in') };
}

/**
 * An inch value that equals the stored value's inch display keeps the stored tenths,
 * so saving the facts in inches never drifts.
 */
export function resolveSizeOnEdit(raw: string, unit: Unit, storedTenths: number): number | null {
  const parsed = parseSizeToTenths(raw, unit);
  if (parsed === null) return null;
  if (unit === 'in' && tenthsToText(storedTenths, 'in') === tenthsToText(parsed, 'in')) {
    return storedTenths;
  }
  return parsed;
}
