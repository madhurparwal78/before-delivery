import {
  compare,
  div,
  fromString,
  mul,
  roundHalfEven,
  toString as decToString,
  type Decimal,
} from './decimal.js';
import { parseNumberGrammar } from './grammar.js';

export interface Quantity {
  text: string;
  unit: string;
}

export type ReadingUnit = 'lx' | 'fc' | 'cd/m2' | 'fL';
export type LengthUnit = 'm' | 'ft';

export const READING_UNITS: readonly ReadingUnit[] = ['lx', 'fc', 'cd/m2', 'fL'];
export const LENGTH_UNITS: readonly LengthUnit[] = ['m', 'ft'];

export const FC_TO_LX = '10.7639104167'; // 1 fc = 10.7639104167 lx
export const FT_TO_M = '0.3048'; // 1 ft = 0.3048 m
export const FL_TO_CDM2 = '3.4262591'; // 1 fL = 3.4262591 cd/m2
export const PI = '3.141592653589793';

export function parseQuantityDecimal(text: string, allowNegative: boolean): Decimal | null {
  const check = parseNumberGrammar(text, allowNegative);
  if (!check.ok || check.value === null) return null;
  return fromString(check.value);
}

// A luminance reading converts to lux as cd/m2 x pi / the cell's reflectance, at acceptance.
export function luxFromQuantity(q: Quantity, reflectance: string | null): string | null {
  const value = parseQuantityDecimal(q.text, true);
  if (!value) return null;
  switch (q.unit) {
    case 'lx':
      return decToString(roundHalfEven(value, 6));
    case 'fc': {
      const rate = fromString(FC_TO_LX);
      if (!rate) return null;
      return decToString(roundHalfEven(mul(value, rate), 6));
    }
    case 'cd/m2':
    case 'fL': {
      const refl = reflectance === null ? null : fromString(reflectance);
      const rate = fromString(q.unit === 'fL' ? FL_TO_CDM2 : '1');
      const pi = fromString(PI);
      if (!refl || !rate || !pi) return null;
      if (refl.digits === '0' || refl.negative) return null;
      const cd = mul(value, rate);
      const lux = div(mul(cd, pi), refl);
      return decToString(roundHalfEven(lux, 6));
    }
    default:
      return null;
  }
}

export function metresFromQuantity(q: Quantity): Decimal | null {
  const value = parseQuantityDecimal(q.text, true);
  if (!value) return null;
  if (q.unit === 'm') return value;
  if (q.unit === 'ft') {
    const rate = fromString(FT_TO_M);
    if (!rate) return null;
    return mul(value, rate);
  }
  return null;
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  return compare(a, b);
}
