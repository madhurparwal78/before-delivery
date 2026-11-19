/** Exact rationals over bigint: decimal arithmetic in this app never passes through a binary float. */
export interface Rational {
  num: bigint;
  den: bigint;
}

const DECIMAL_FORM = /^\d+(?:\.\d+)?$/;

export function isDecimal(text: string): boolean {
  return DECIMAL_FORM.test(text);
}

export function rational(text: string): Rational {
  const [whole = "0", fraction = ""] = text.split(".");
  return { num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
}

export function fractionDigits(text: string): number {
  return text.split(".")[1]?.length ?? 0;
}

export function times(a: Rational, b: Rational): Rational {
  return { num: a.num * b.num, den: a.den * b.den };
}

export function over(a: Rational, b: Rational): Rational {
  return { num: a.num * b.den, den: a.den * b.num };
}

export function whole(n: bigint | number): Rational {
  return { num: BigInt(n), den: 1n };
}

export function roundHalfUp(value: Rational): bigint {
  return (2n * value.num + value.den) / (2n * value.den);
}

export function roundUp(value: Rational): bigint {
  return (value.num + value.den - 1n) / value.den;
}

export function roundDown(value: Rational): bigint {
  return value.num / value.den;
}

/** Half up to `digits` decimals, printed with exactly that many. */
export function fixed(value: Rational, digits: number): string {
  return scaled(roundHalfUp(times(value, whole(10n ** BigInt(digits)))), digits);
}

/** Prints an integer holding `digits` implied decimals. */
export function scaled(units: bigint, digits: number): string {
  if (digits === 0) return units.toString();
  const text = units.toString().padStart(digits + 1, "0");
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
