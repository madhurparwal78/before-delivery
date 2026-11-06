// Exact decimal arithmetic on BigInt (adapted from kit/modules/money): every amount, reading and
// conversion in Lacquer rounds through roundHalfUp, the one rounding rule the brief publishes.

/** num/den rounded to an integer, ties away from zero. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("denominator is zero");
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let q = n / d;
  let r = n % d;
  if (r < 0n) {
    q -= 1n;
    r += d;
  }
  if (2n * r !== d) return 2n * r < d ? q : q + 1n;
  return n >= 0n ? q + 1n : q;
}

export interface Rational {
  num: bigint;
  den: bigint;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parses a plain decimal string ("12.34", "7") into an exact rational, or null. */
export function parseDecimal(text: string): Rational | null {
  const match = DECIMAL.exec(text.trim());
  if (!match) return null;
  const fraction = match[3] ?? "";
  const num = BigInt(`${match[1]}${match[2]}${fraction}`);
  return { num, den: 10n ** BigInt(fraction.length) };
}

/** Number of digits after the decimal point in a plain decimal string. */
export function decimalPlaces(text: string): number {
  const dot = text.trim().indexOf(".");
  return dot < 0 ? 0 : text.trim().length - dot - 1;
}

/** Minor units (scale 10^places) as a fixed-point string, e.g. 447070n, 2 -> "4470.70". */
export function formatScaled(value: bigint, places: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? `.${digits.slice(digits.length - places)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Rounds a rational to the given number of decimal places, half up, as scaled minor units. */
export function toScaled(value: Rational, places: number): bigint {
  return roundHalfUp(value.num * 10n ** BigInt(places), value.den);
}
