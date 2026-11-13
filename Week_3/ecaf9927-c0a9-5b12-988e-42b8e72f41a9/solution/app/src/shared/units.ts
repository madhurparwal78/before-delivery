import type { LengthUnit, Tolerance } from './api';

/** One inch is exactly 25.4 mm. Every unit conversion in the product goes through this constant. */
export const MM_PER_INCH = 25.4;

/** Display unit of a length (power 1), area (power 2) or volume (power 3) given in millimetre powers. */
export function unitScale(unit: LengthUnit, power: 1 | 2 | 3): number {
  return unit === 'in' ? MM_PER_INCH ** power : 1;
}

/**
 * Rounds half away from zero on the shortest decimal form of the number,
 * the way a person reading the digits would, and prints exactly `decimals` places.
 */
export function roundHalfAwayFromZero(value: number, decimals: number): string {
  if (value === 0 || !Number.isFinite(value)) return (0).toFixed(decimals);
  const negative = value < 0;
  const [mantissa = '0', exponentText = '0'] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const pointAt = Number(exponentText) + 1; // digits before the decimal point (may be <= 0)
  const keep = pointAt + decimals; // number of leading digits that survive
  let kept: string;
  if (keep < 0) {
    kept = '0';
  } else {
    const padded = digits.padEnd(keep + 1, '0');
    let integer = BigInt(padded.slice(0, keep) || '0');
    if (Number(padded[keep]) >= 5) integer += 1n;
    kept = integer.toString();
  }
  const whole = kept.padStart(decimals + 1, '0');
  const text = decimals === 0 ? whole : `${whole.slice(0, -decimals)}.${whole.slice(-decimals)}`;
  const isZero = /^[0.]+$/.test(text);
  return negative && !isZero ? `-${text}` : text;
}

function scaled(valueMm: number, unit: LengthUnit, precision: number, power: 1 | 2 | 3): string {
  return roundHalfAwayFromZero(valueMm / unitScale(unit, power), precision);
}

export const formatLengthPlain = (mm: number, unit: LengthUnit, precision: number): string =>
  scaled(mm, unit, precision, 1);

export const formatArea = (mm2: number, unit: LengthUnit, precision: number): string =>
  `${scaled(mm2, unit, precision, 2)} ${unit}²`;

export const formatVolume = (mm3: number, unit: LengthUnit, precision: number): string =>
  `${scaled(mm3, unit, precision, 3)} ${unit}³`;

export const formatMass = (grams: number): string => `${roundHalfAwayFromZero(grams, 2)} g`;

export const formatDensity = (gPerCm3: number): string => `${roundHalfAwayFromZero(gPerCm3, 2)} g/cm³`;

export function formatCentroid(c: { x: number; y: number; z: number }, unit: LengthUnit, precision: number): string {
  const parts = [c.x, c.y, c.z].map((v) => formatLengthPlain(v, unit, precision));
  return `(${parts.join(', ')}) ${unit}`;
}

/** A dimension with its tolerance; `withUnit` false gives the canvas label form. */
export function formatDimension(
  nominalMm: number,
  tolerance: Tolerance | undefined,
  unit: LengthUnit,
  precision: number,
  withUnit = true,
): string {
  const nominal = formatLengthPlain(nominalMm, unit, precision);
  const suffix = withUnit ? ` ${unit}` : '';
  if (!tolerance) return `${nominal}${suffix}`;
  const plus = formatLengthPlain(tolerance.plus_mm, unit, precision);
  const minus = formatLengthPlain(tolerance.minus_mm, unit, precision);
  return tolerance.kind === 'symmetric'
    ? `${nominal} ± ${plus}${suffix}`
    : `${nominal} +${plus} −${minus}${suffix}`;
}

/** Full-precision text for editing a stored length in the member's display unit (no rounding to the display precision). */
export function editableLength(mm: number, unit: LengthUnit): string {
  const value = mm / unitScale(unit, 1);
  return String(Number(value.toPrecision(12)));
}

/** The text grammar for a stored tolerance, in the member's display unit (no suffix), ready to edit. */
export function toleranceText(tolerance: Tolerance, unit: LengthUnit): string {
  const plus = editableLength(tolerance.plus_mm, unit);
  return tolerance.kind === 'symmetric' ? `\u00b1${plus}` : `+${plus}/\u2212${editableLength(tolerance.minus_mm, unit)}`;
}
