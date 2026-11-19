import Decimal from 'decimal.js';

Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });

export { Decimal };

export const ZERO = new Decimal(0);

export function dec(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((a, b) => a.plus(b), ZERO);
}

/** A plain decimal string with no exponent. */
export function plain(value: Decimal): string {
  return value.toFixed();
}
