/** Exact rational arithmetic on bigints. No floating point reaches a shown amount. */
export type Rational = { readonly n: bigint; readonly d: bigint };

export function rational(n: bigint | number, d: bigint | number = 1n): Rational {
  return { n: BigInt(n), d: BigInt(d) };
}

export function multiply(a: Rational, b: Rational): Rational {
  return { n: a.n * b.n, d: a.d * b.d };
}

export function divide(a: Rational, b: Rational): Rational {
  return { n: a.n * b.d, d: a.d * b.n };
}

/** Half up on the exact value: 37.5 becomes 38, 44.955 becomes 45. */
export function roundHalfUp(value: Rational): bigint {
  const twiceNumerator = 2n * value.n + value.d;
  const twiceDenominator = 2n * value.d;
  return floorDivide(twiceNumerator, twiceDenominator);
}

export function roundUp(value: Rational): bigint {
  const quotient = floorDivide(value.n, value.d);
  return quotient * value.d === value.n ? quotient : quotient + 1n;
}

function floorDivide(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}

/** Half up to `decimals` places, printed with exactly that many decimals. */
export function toFixedHalfUp(value: Rational, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const scaled = roundHalfUp(multiply(value, rational(scale)));
  const sign = scaled < 0n ? '-' : '';
  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return sign + digits;
  const whole = digits.slice(0, digits.length - decimals);
  return `${sign}${whole}.${digits.slice(digits.length - decimals)}`;
}

/** Reads a plain decimal string such as "1835.50" or "1,5" once its point is known. */
export function parseDecimal(text: string, point: '.' | ',' = '.'): Rational | null {
  const other = point === '.' ? ',' : '.';
  if (text.includes(other) || text.length === 0) return null;
  const normalised = point === '.' ? text : text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  const [whole = '', fraction = ''] = normalised.split('.');
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}

export function decimalPlaces(text: string): number {
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function isPositive(value: Rational): boolean {
  return value.n > 0n === value.d > 0n && value.n !== 0n;
}

export function compare(a: Rational, b: Rational): number {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}
