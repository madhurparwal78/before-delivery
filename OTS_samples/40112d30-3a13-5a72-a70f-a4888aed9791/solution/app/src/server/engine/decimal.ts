/** Exact decimal arithmetic on BigInt: the value is `n / 10^scale`, always kept in lowest terms. */
export interface Decimal {
  readonly n: bigint;
  readonly scale: number;
}

/** The most digits any calculated number may have (whole digits plus decimals up to the last non-zero one). */
const MAX_DIGITS = 1000;
/** Decimal places kept by `/` and `AVG`. */
export const QUOTIENT_PLACES = 12;

export const ZERO: Decimal = { n: 0n, scale: 0 };

const EXACT_DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);
const magnitude = (value: bigint): bigint => (value < 0n ? -value : value);

function build(n: bigint, scale: number): Decimal {
  if (n === 0n) return ZERO;
  const digits = magnitude(n).toString();
  let trailing = 0;
  while (trailing < scale && digits[digits.length - 1 - trailing] === '0') trailing += 1;
  return trailing === 0 ? { n, scale } : { n: n / pow10(trailing), scale: scale - trailing };
}

/** Division of `numerator` by a positive `denominator`, half away from zero. */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  if (magnitude(numerator % denominator) * 2n < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

function render(n: bigint, scale: number): string {
  const digits = magnitude(n).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${n < 0n ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

function wholeDigits(value: Decimal): number {
  return Math.max(magnitude(value.n).toString().length - value.scale, 1);
}

export function isExactDecimal(text: string): boolean {
  return EXACT_DECIMAL.test(text.trim());
}

/** Parses `-?[0-9]+(.[0-9]+)?` after trimming; anything else is null. */
export function parseDecimal(text: string): Decimal | null {
  const match = EXACT_DECIMAL.exec(text.trim());
  if (match === null) return null;
  const [, sign, whole = '', fraction = ''] = match;
  const n = BigInt(whole + fraction);
  return build(sign === '-' ? -n : n, fraction.length);
}

/** Like `parseDecimal` for text already known to be an exact decimal. */
export function exactDecimal(text: string): Decimal {
  const value = parseDecimal(text);
  if (value === null) throw new RangeError(`Not an exact decimal: ${text}`);
  return value;
}

export function integerDecimal(value: number): Decimal {
  return build(BigInt(value), 0);
}

function digitCount(value: Decimal): number {
  return wholeDigits(value) + value.scale;
}

export function fitsDigitLimit(value: Decimal): boolean {
  return digitCount(value) <= MAX_DIGITS;
}

export function isZero(value: Decimal): boolean {
  return value.n === 0n;
}

export function isWhole(value: Decimal): boolean {
  return value.scale === 0;
}

export function negateDecimal(value: Decimal): Decimal {
  return build(-value.n, value.scale);
}

export function absoluteDecimal(value: Decimal): Decimal {
  return value.n < 0n ? negateDecimal(value) : value;
}

export function compareDecimals(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const left = a.n * pow10(scale - a.scale);
  const right = b.n * pow10(scale - b.scale);
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function addDecimals(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return build(a.n * pow10(scale - a.scale) + b.n * pow10(scale - b.scale), scale);
}

export function subtractDecimals(a: Decimal, b: Decimal): Decimal {
  return addDecimals(a, negateDecimal(b));
}

export function multiplyDecimals(a: Decimal, b: Decimal): Decimal {
  return build(a.n * b.n, a.scale + b.scale);
}

/** `dividend / divisor` rounded half away from zero to `places` decimals. The divisor must not be zero. */
export function divideDecimals(dividend: Decimal, divisor: Decimal, places: number): Decimal {
  const numerator = dividend.n * pow10(divisor.scale + places);
  const denominator = divisor.n * pow10(dividend.scale);
  const sign = denominator < 0n ? -1n : 1n;
  return build(roundedQuotient(numerator * sign, denominator * sign), places);
}

/** The remainder of `dividend / divisor`, taking the sign of the divisor. The divisor must not be zero. */
export function remainderDecimals(dividend: Decimal, divisor: Decimal): Decimal {
  const scale = Math.max(dividend.scale, divisor.scale);
  const left = dividend.n * pow10(scale - dividend.scale);
  const right = divisor.n * pow10(scale - divisor.scale);
  const remainder = left % right;
  const adjusted = remainder !== 0n && remainder < 0n !== (right < 0n) ? remainder + right : remainder;
  return build(adjusted, scale);
}

/**
 * `base ^ exponent`, or null when the result would have more than MAX_DIGITS digits. The digit count is
 * bounded from below before any multiplication, so no oversized power is ever computed.
 */
export function powerDecimal(base: Decimal, exponent: number): Decimal | null {
  const lowerBound = exponent * (wholeDigits(base) - 1) + 1 + exponent * base.scale;
  if (lowerBound > MAX_DIGITS) return null;
  const result = build(base.n ** BigInt(exponent), base.scale * exponent);
  return fitsDigitLimit(result) ? result : null;
}

/** Rounds half away from zero to `places` decimals; a negative `places` rounds to tens, hundreds and so on. */
export function roundDecimal(value: Decimal, places: number): Decimal {
  if (places >= value.scale) return value;
  if (places >= 0) return build(roundedQuotient(value.n, pow10(value.scale - places)), places);
  const tens = -places;
  if (tens > wholeDigits(value)) return ZERO;
  return build(roundedQuotient(value.n, pow10(value.scale + tens)) * pow10(tens), 0);
}

export function floorDecimal(value: Decimal): Decimal {
  if (value.scale === 0) return value;
  const divisor = pow10(value.scale);
  const quotient = value.n / divisor;
  return build(value.n < 0n && quotient * divisor !== value.n ? quotient - 1n : quotient, 0);
}

export function ceilDecimal(value: Decimal): Decimal {
  return negateDecimal(floorDecimal(negateDecimal(value)));
}

/** The whole part (toward zero) as a JavaScript number, clamped to `-bound..bound`. */
export function truncatedInteger(value: Decimal, bound: number): number {
  const whole = value.n / pow10(value.scale);
  const limit = BigInt(bound);
  if (whole > limit) return bound;
  return whole < -limit ? -bound : Number(whole);
}

/** Number text: no trailing zeros, no exponent, no separators. */
export function formatDecimal(value: Decimal): string {
  return render(value.n, value.scale);
}

/** The value rounded half away from zero and shown with exactly `places` decimals. */
export function fixedDecimal(value: Decimal, places: number): string {
  const rounded = roundDecimal(value, places);
  return render(rounded.n * pow10(places - rounded.scale), places);
}
