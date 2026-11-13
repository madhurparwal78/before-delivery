/** An exact decimal: `units` scaled by 10^-`scale`. */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

const TEN = 10n;

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

export function decimal(units: bigint, scale: number): Decimal {
  return { units, scale };
}

export function fromInteger(value: number | bigint): Decimal {
  return { units: BigInt(value), scale: 0 };
}

/** Reads a plain decimal literal with an optional sign and a point as the mark. */
export function parseDecimal(text: string): Decimal {
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const point = unsigned.indexOf('.');
  const digits = point === -1 ? unsigned : unsigned.slice(0, point) + unsigned.slice(point + 1);
  const scale = point === -1 ? 0 : unsigned.length - point - 1;
  const units = BigInt(digits === '' ? '0' : digits);
  return { units: negative ? -units : units, scale };
}

export function rescale(value: Decimal, scale: number): Decimal {
  if (scale === value.scale) return value;
  if (scale > value.scale) {
    return { units: value.units * pow10(scale - value.scale), scale };
  }
  return roundHalfEven(value, scale);
}

function align(a: Decimal, b: Decimal): readonly [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale];
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [left, right, scale] = align(a, b);
  return { units: left + right, scale };
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function compare(a: Decimal, b: Decimal): number {
  const [left, right] = align(a, b);
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Half-even rounding of `numerator / denominator` to a whole number. */
export function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const twice = remainder * 2n;
  let rounded = quotient;
  if (twice > absDenominator || (twice === absDenominator && quotient % 2n === 1n)) {
    rounded = quotient + 1n;
  }
  return negative ? -rounded : rounded;
}

export function roundHalfEven(value: Decimal, scale: number): Decimal {
  if (scale >= value.scale) return rescale(value, scale);
  const divisor = pow10(value.scale - scale);
  return { units: divideRoundHalfEven(value.units, divisor), scale };
}

/** Exact division carried out to `scale` decimals with one half-even rounding. */
export function divide(a: Decimal, b: Decimal, scale: number): Decimal {
  const numerator = a.units * pow10(scale + b.scale);
  const denominator = b.units * pow10(a.scale);
  return { units: divideRoundHalfEven(numerator, denominator), scale };
}

export function isWhole(value: Decimal): boolean {
  return value.units % pow10(value.scale) === 0n;
}

export function ceilToInteger(value: Decimal): number {
  const divisor = pow10(value.scale);
  const whole = value.units / divisor;
  const remainder = value.units % divisor;
  return Number(remainder > 0n ? whole + 1n : whole);
}

export function toFixed(value: Decimal, scale: number): string {
  const rounded = roundHalfEven(value, scale);
  const negative = rounded.units < 0n;
  const digits = (negative ? -rounded.units : rounded.units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`;
  const body = `${whole}${fraction}`;
  return negative && rounded.units !== 0n ? `-${body}` : body;
}
