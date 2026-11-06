/**
 * Exact decimal arithmetic. A value is `units / 10^scale`, held in a BigInt,
 * so no tonnage, buffer or coverage figure ever passes through binary floating point.
 */
export interface Dec {
  readonly units: bigint;
  readonly scale: number;
}

const TEN = 10n;

function pow10(n: number): bigint {
  return TEN ** BigInt(n);
}

export function dec(units: bigint, scale: number): Dec {
  return { units, scale };
}

export const ZERO: Dec = dec(0n, 0);

/** Parses a plain decimal literal such as `-3.0000`, `17`, `+0.5`. */
export function fromString(text: string): Dec {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new Error(`not a decimal literal: ${text}`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] === '' ? '0' : match[2]!;
  const frac = match[3] ?? '';
  return dec(sign * BigInt(whole + frac), frac.length);
}

function rescale(value: Dec, scale: number): bigint {
  if (scale < value.scale) throw new Error('rescale would lose digits');
  return value.units * pow10(scale - value.scale);
}

export function add(a: Dec, b: Dec): Dec {
  const scale = Math.max(a.scale, b.scale);
  return dec(rescale(a, scale) + rescale(b, scale), scale);
}

export function sum(values: readonly Dec[]): Dec {
  return values.reduce<Dec>((acc, value) => add(acc, value), ZERO);
}

export function sub(a: Dec, b: Dec): Dec {
  const scale = Math.max(a.scale, b.scale);
  return dec(rescale(a, scale) - rescale(b, scale), scale);
}

export function neg(a: Dec): Dec {
  return dec(-a.units, a.scale);
}

export function mul(a: Dec, b: Dec): Dec {
  return dec(a.units * b.units, a.scale + b.scale);
}

export function isNegative(a: Dec): boolean {
  return a.units < 0n;
}

export function compare(a: Dec, b: Dec): number {
  const scale = Math.max(a.scale, b.scale);
  const left = rescale(a, scale);
  const right = rescale(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Divides two BigInts, rounding half to even at `scale` decimals. */
export function divideRounded(numerator: bigint, denominator: bigint, scale: number): Dec {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const shifted = magnitude * pow10(scale);
  const quotient = shifted / denominator;
  const remainder = shifted % denominator;
  const twice = remainder * 2n;
  let rounded = quotient;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) {
    rounded = quotient + 1n;
  }
  return dec(negative ? -rounded : rounded, scale);
}

/** Rounds half to even at `scale` decimals. */
export function round(value: Dec, scale: number): Dec {
  if (value.scale <= scale) return dec(rescale(value, scale), scale);
  const quotient = divideRounded(value.units, pow10(value.scale - scale), 0);
  return dec(quotient.units, scale);
}

/** Floors toward negative infinity at `scale` decimals. */
export function floorAt(value: Dec, scale: number): Dec {
  if (value.scale <= scale) return dec(rescale(value, scale), scale);
  const divisor = pow10(value.scale - scale);
  let quotient = value.units / divisor;
  if (value.units % divisor !== 0n && value.units < 0n) quotient -= 1n;
  return dec(quotient, scale);
}

/** Renders the value with exactly `scale` decimals, with a leading `-` only when negative. */
export function toFixed(value: Dec, scale: number): string {
  const rounded = round(value, scale);
  const negative = rounded.units < 0n;
  const digits = (negative ? -rounded.units : rounded.units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  const text = `${whole}${frac}`;
  return negative && rounded.units !== 0n ? `-${text}` : text;
}

/** `<tonnes>`: three decimals, leading `-` when negative. */
export function tonnes(value: Dec): string {
  return toFixed(value, 3);
}

/** `<coverage>`, `<floor>`, `buffer_pct`: one decimal. */
export function percent(value: Dec): string {
  return toFixed(value, 1);
}
