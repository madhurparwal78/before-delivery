/**
 * Exact decimal arithmetic on BigInt. No ETH or USD amount, figure or ratio in
 * Tracewell ever passes through a binary floating-point number.
 *
 * A decimal is an unscaled BigInt plus a scale: value = unscaled / 10^scale.
 */
export interface Decimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

export const COMPUTATION_SCALE = 18;

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*|[0-9]+)(?:\.[0-9]+)?$/;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

export function decimal(unscaled: bigint, scale: number): Decimal {
  return { unscaled, scale };
}

export function fromInteger(value: bigint): Decimal {
  return { unscaled: value, scale: 0 };
}

/** Parses a plain decimal literal. Returns null for anything else. */
export function parseDecimal(text: string): Decimal | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 80) return null;
  if (!DECIMAL_PATTERN.test(text)) return null;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const digits = dot < 0 ? unsigned : unsigned.slice(0, dot) + unsigned.slice(dot + 1);
  const scale = dot < 0 ? 0 : unsigned.length - dot - 1;
  const magnitude = BigInt(digits);
  return { unscaled: negative ? -magnitude : magnitude, scale };
}

export function fractionalDigits(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Rounds half away from zero. This is the only rounding rule in Tracewell. */
export function rescale(value: Decimal, scale: number): Decimal {
  if (scale === value.scale) return value;
  if (scale > value.scale) {
    return { unscaled: value.unscaled * pow10(scale - value.scale), scale };
  }
  const divisor = pow10(value.scale - scale);
  const negative = value.unscaled < 0n;
  const magnitude = negative ? -value.unscaled : value.unscaled;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return { unscaled: negative ? -rounded : rounded, scale };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [rescale(a, scale).unscaled, rescale(b, scale).unscaled, scale];
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { unscaled: x + y, scale };
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { unscaled: x - y, scale };
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return { unscaled: a.unscaled * b.unscaled, scale: a.scale + b.scale };
}

/** Exact quotient rounded half away from zero at `scale` fractional digits. */
export function divide(a: Decimal, b: Decimal, scale: number): Decimal {
  if (b.unscaled === 0n) throw new Error('division by zero');
  // a/b = (a.unscaled * 10^(scale + b.scale - a.scale)) / b.unscaled, rounded.
  const shift = scale + b.scale - a.scale;
  let numerator = a.unscaled;
  let denominator = b.unscaled;
  if (shift >= 0) numerator *= pow10(shift);
  else denominator *= pow10(-shift);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return { unscaled: negative ? -rounded : rounded, scale };
}

export function compare(a: Decimal, b: Decimal): number {
  const [x, y] = align(a, b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

export function equals(a: Decimal, b: Decimal): boolean {
  return compare(a, b) === 0;
}

export function isNegative(value: Decimal): boolean {
  return value.unscaled < 0n;
}

export function isZero(value: Decimal): boolean {
  return value.unscaled === 0n;
}

/** Renders the decimal at its own scale, keeping trailing zeros. */
export function toPlainString(value: Decimal): string {
  const negative = value.unscaled < 0n;
  const digits = (negative ? -value.unscaled : value.unscaled).toString();
  let text: string;
  if (value.scale === 0) {
    text = digits;
  } else {
    const padded = digits.padStart(value.scale + 1, '0');
    text = `${padded.slice(0, padded.length - value.scale)}.${padded.slice(padded.length - value.scale)}`;
  }
  return negative ? `-${text}` : text;
}

/** Renders at exactly `scale` fractional digits, rounding half away from zero. */
export function toFixed(value: Decimal, scale: number): string {
  return toPlainString(rescale(value, scale));
}

export function withCommas(text: string): string {
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const whole = dot < 0 ? unsigned : unsigned.slice(0, dot);
  const rest = dot < 0 ? '' : unsigned.slice(dot);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${rest}`;
}
