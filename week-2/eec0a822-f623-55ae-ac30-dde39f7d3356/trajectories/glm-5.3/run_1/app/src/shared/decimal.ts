import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Round half up to n decimal places. */
export function roundHalfUp(value: Decimal, places: number): Decimal {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

export function div(a: Decimal, b: Decimal): Decimal {
  return Decimal.div(a, b);
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return Decimal.mul(a, b);
}

export function add(a: Decimal, b: Decimal): Decimal {
  return Decimal.add(a, b);
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return Decimal.sub(a, b);
}

export function pow(a: Decimal, exponent: number): Decimal {
  return a.pow(exponent);
}

/** Convert EUR minor units to another currency at a rate, rounding half up to the minor unit. */
export function convertMinor(eurMinor: string | number, rate: string, minorDigits: number): string {
  return roundHalfUp(mul(new Decimal(String(eurMinor)), new Decimal(rate)), minorDigits).toFixed(0);
}
