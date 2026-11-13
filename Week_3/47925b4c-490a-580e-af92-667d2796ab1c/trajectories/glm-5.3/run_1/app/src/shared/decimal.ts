// Exact decimal arithmetic on strings (no floating point touches any measure or cent).
// A Decimal is digits / 10^scale with digits a non-negative integer string without leading zeros.
// Internal work uses BigInt only as an integer engine; values stay exact decimals.

export interface Decimal {
  negative: boolean;
  digits: string; // integer, no leading zeros, "0" when zero
  scale: number; // digits after the decimal point
}

const ZERO = '0';

export function zero(): Decimal {
  return { negative: false, digits: ZERO, scale: 0 };
}

export function fromString(text: string): Decimal | null {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot + 1);
  return make(negative, int + frac, frac.length);
}

export function fromInteger(n: number | bigint): Decimal {
  return make(n < 0, String(n < 0 ? -n : n), 0);
}

export function make(negative: boolean, digits: string, scale: number): Decimal {
  let ds = digits.replace(/^0+(?=\d)/, '');
  if (ds === '' || /^0+$/.test(ds)) return zero();
  let sc = scale;
  while (sc > 0 && ds.endsWith(ZERO)) {
    ds = ds.slice(0, -1);
    sc--;
  }
  return { negative, digits: ds, scale: sc };
}

// The integer behind a Decimal: digits, signed; the scale is tracked by the caller.
export function toBigInt(a: Decimal): bigint {
  const v = BigInt(a.digits);
  return a.negative ? -v : v;
}

export function fromBigInt(v: bigint, scale: number): Decimal {
  return make(v < 0, (v < 0 ? -v : v).toString(), scale);
}

export function toString(a: Decimal): string {
  if (a.digits === ZERO) return ZERO;
  const sign = a.negative ? '-' : '';
  if (a.scale === 0) return sign + a.digits;
  if (a.digits.length <= a.scale) {
    return sign + '0.' + ZERO.repeat(a.scale - a.digits.length) + a.digits;
  }
  return sign + a.digits.slice(0, a.digits.length - a.scale) + '.' + a.digits.slice(a.digits.length - a.scale);
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return fromBigInt(
    toBigInt(rescale(a, scale)) + toBigInt(rescale(b, scale)),
    scale,
  );
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return fromBigInt(
    toBigInt(rescale(a, scale)) - toBigInt(rescale(b, scale)),
    scale,
  );
}

export function negate(a: Decimal): Decimal {
  return a.digits === ZERO ? a : { ...a, negative: !a.negative };
}

export function abs(a: Decimal): Decimal {
  return { ...a, negative: false };
}

export function mul(a: Decimal, b: Decimal): Decimal {
  if (a.digits === ZERO || b.digits === ZERO) return zero();
  return fromBigInt(toBigInt(a) * toBigInt(b), a.scale + b.scale);
}

// Long division to `guard` digits beyond the greater scale; callers round afterwards.
export function div(a: Decimal, b: Decimal, guard = 40): Decimal {
  if (b.digits === ZERO) throw new Error('division by zero');
  if (a.digits === ZERO) return zero();
  const work = Math.max(a.scale, b.scale) + guard;
  const numerator = toBigInt(rescale(a, work));
  const denominator = toBigInt(rescale(b, b.scale));
  return fromBigInt(numerator / denominator, work - b.scale);
}

export function compare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const left = toBigInt(rescale(a, scale));
  const right = toBigInt(rescale(b, scale));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareAbs(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const left = toBigInt(rescale(abs(a), scale));
  const right = toBigInt(rescale(abs(b), scale));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isZero(a: Decimal): boolean {
  return a.digits === ZERO;
}

// Rounds to `places` decimals, half to even, in one step at the end.
export function roundHalfEven(a: Decimal, places: number): Decimal {
  const drop = a.scale - places;
  if (drop <= 0) return a;
  const pow = 10n ** BigInt(drop);
  const value = toBigInt(a);
  const negative = value < 0;
  const mag = negative ? -value : value;
  const quotient = mag / pow;
  const remainder = mag % pow;
  const half = pow / 2n;
  let rounded = quotient;
  if (remainder > half) rounded = quotient + 1n;
  else if (remainder === half) {
    rounded = quotient % 2n === 1n ? quotient + 1n : quotient;
  }
  return fromBigInt(negative ? -rounded : rounded, places);
}

// Rounds to `places` decimals, half away from zero (for countdown ceilings use ceilToInteger).
export function roundHalfUp(a: Decimal, places: number): Decimal {
  const drop = a.scale - places;
  if (drop <= 0) return a;
  const pow = 10n ** BigInt(drop);
  const value = toBigInt(a);
  const negative = value < 0;
  const mag = negative ? -value : value;
  const doubled = mag * 2n;
  const rounded = (doubled + pow) / (2n * pow);
  return fromBigInt(negative ? -rounded : rounded, places);
}

export function ceilToInteger(a: Decimal): Decimal {
  if (a.scale === 0) return a;
  const pow = 10n ** BigInt(a.scale);
  const value = toBigInt(a);
  const negative = value < 0;
  const mag = negative ? -value : value;
  const truncated = mag / pow;
  const ceil = mag % pow === 0n ? truncated : truncated + 1n;
  return fromBigInt(negative ? -truncated : ceil, 0);
}

export function toStringFixed(a: Decimal, places: number): string {
  const r = roundHalfEven(a, places);
  const s = toString(r);
  const [int = ZERO, frac = ''] = s.split('.');
  return (r.negative && r.digits !== ZERO ? '-' : '') + int + '.' + frac.padEnd(places, ZERO);
}

// Rescales by shifting the decimal point; truncating only when the target has fewer
// digits, which never happens in the paths that feed it.
export function rescale(a: Decimal, scale: number): Decimal {
  if (a.scale === scale) return a;
  if (a.scale < scale) {
    return { ...a, digits: a.digits + ZERO.repeat(scale - a.scale), scale };
  }
  const drop = a.scale - scale;
  const divisor = 10n ** BigInt(drop);
  const digits = (BigInt(a.digits) / divisor).toString();
  return { negative: a.negative, digits, scale };
}
