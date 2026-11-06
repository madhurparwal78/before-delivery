// Exact decimal arithmetic on bigint. No amount, price or ratio passes through a float.

export interface Decimal {
  units: bigint;
  scale: number;
}

const STORED_PLACES = 18;

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

function power10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Non-negative decimal text, at most `maxFraction` fractional digits. */
export function parseDecimal(text: string, maxFraction = Number.POSITIVE_INFINITY): Decimal | null {
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > maxFraction) return null;
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

export function requireDecimal(text: string): Decimal {
  const parsed = parseDecimal(text);
  if (!parsed) throw new RangeError("not a decimal");
  return parsed;
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * power10(scale - a.scale), b.units * power10(scale - b.scale), scale];
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const [left, right] = align(a, b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const [left, right, scale] = align(a, b);
  return { units: left + right, scale };
}

export interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

export function fractionOf(value: Decimal): Fraction {
  return { numerator: value.units, denominator: power10(value.scale) };
}

export function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  return { numerator: a.numerator * b.numerator, denominator: a.denominator * b.denominator };
}

export function divideFractions(a: Fraction, b: Fraction): Fraction {
  return { numerator: a.numerator * b.denominator, denominator: a.denominator * b.numerator };
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Round half away from zero to `places` fractional digits and write the result as digits. */
function roundFraction(fraction: Fraction, places: number): string {
  const negative = fraction.numerator < 0n !== fraction.denominator < 0n;
  const numerator = fraction.numerator < 0n ? -fraction.numerator : fraction.numerator;
  const denominator = fraction.denominator < 0n ? -fraction.denominator : fraction.denominator;
  const scaled = (numerator * power10(places) * 2n + denominator) / (2n * denominator);
  const digits = scaled.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const tail = digits.slice(digits.length - places);
  const text = places === 0 ? whole : `${whole}.${tail}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}

/** The stored form of a figure: exactly 18 fractional digits, half away from zero at the 18th. */
export function storeFraction(fraction: Fraction): string {
  return roundFraction(fraction, STORED_PLACES);
}

function roundedText(value: string, places: number): string {
  return roundFraction(fractionOf(requireDecimal(value)), places);
}

function grouped(text: string): string {
  const [whole = "", tail] = text.split(".");
  return tail === undefined ? groupThousands(whole) : `${groupThousands(whole)}.${tail}`;
}

export function formatEth(value: string): string {
  return `${grouped(roundedText(value, 3))} ETH`;
}

export function formatPerThousand(value: string): string {
  return grouped(roundedText(value, 4));
}

export function formatMnav(value: string): string {
  return `${grouped(roundedText(value, 3))}×`;
}

export function formatUsd(value: string): string {
  return `$${grouped(roundedText(value, 2))}`;
}

export function formatShares(value: string): string {
  return grouped(roundedText(value, 0));
}
