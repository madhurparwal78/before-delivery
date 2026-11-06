// Decimal rounding on the shortest decimal form of a number, so 0.15 rounds like the written 0.15.

/** Digits of |value| in its shortest round-trip form, and where the decimal point sits among them. */
function decimalDigits(value: number): { digits: string; point: number } {
  const text = String(Math.abs(value));
  const [mantissa, exponent = "0"] = text.split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  return { digits: whole + fraction, point: whole.length + Number(exponent) };
}

/** Round to `places` decimals, halves away from zero (the brief's "half up" for its non-negative values). */
export function roundHalf(value: number, places: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const { digits, point } = decimalDigits(value);
  const keep = point + places;
  if (keep < 0) return 0;
  const padded = digits.padEnd(keep + 1, "0");
  let head = BigInt(padded.slice(0, keep) || "0");
  if (Number(padded[keep]) >= 5) head += 1n;
  const result = Number(head) / 10 ** places;
  return value < 0 ? -result : result;
}

/** One decimal, written with exactly one digit after the point ("120.0"). */
export function fixed1(value: number): string {
  return roundHalf(value, 1).toFixed(1);
}

/** A number without trailing zeros (250, 120.5). */
export function plain(value: number): string {
  return String(roundHalf(value, 3));
}

/** Hours in records are rounded to 0.001. */
export function hours(value: number): number {
  return roundHalf(value, 3);
}
