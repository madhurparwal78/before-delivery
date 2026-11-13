import { type Decimal, divide, multiply, parseDecimal, rescale, roundHalfEven } from './decimal.js';

const FOOT_CANDLE_LUX = parseDecimal('10.7639104167');
const FOOT_METRES = parseDecimal('0.3048');
const FOOT_LAMBERT_NITS = parseDecimal('3.4262591');
const PI = parseDecimal('3.141592653589793');

export const LENGTH_UNITS = ['m', 'ft'] as const;
export const AMBIENT_UNITS = ['lx', 'fc', 'cd/m2', 'fL'] as const;

export type LengthUnit = (typeof LENGTH_UNITS)[number];
export type AmbientUnit = (typeof AMBIENT_UNITS)[number];

export const LENGTH_SCALE = 6;
const LUX_SCALE = 6;

export function lengthToMetres(value: Decimal, unit: LengthUnit): Decimal {
  return unit === 'm' ? rescale(value, Math.max(value.scale, 0)) : multiply(value, FOOT_METRES);
}

/**
 * Canonical lux for an ambient reading. Luminance units pass through the cell's
 * reflectance. The single half-even rounding happens here, at the end.
 */
export function ambientToLux(value: Decimal, unit: AmbientUnit, reflectance: Decimal): Decimal {
  switch (unit) {
    case 'lx':
      return roundHalfEven(value, LUX_SCALE);
    case 'fc':
      return roundHalfEven(multiply(value, FOOT_CANDLE_LUX), LUX_SCALE);
    case 'cd/m2':
      return divide(multiply(value, PI), reflectance, LUX_SCALE);
    case 'fL':
      return divide(multiply(multiply(value, FOOT_LAMBERT_NITS), PI), reflectance, LUX_SCALE);
  }
}
