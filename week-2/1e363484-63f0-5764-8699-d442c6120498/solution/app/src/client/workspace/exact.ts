// Exact fixed-point arithmetic for the server's decimal strings (tonnes, buffer, coverage): every value is a
// bigint count of its last decimal place, divisions round half to even. No JavaScript `number` ever holds them.

/** "85.0" → 850n tenths, "-16.808" → -16808n thousandths. */
export function toUnits(text: string, decimals: number): bigint {
  const negative = text.trim().startsWith("-");
  const [whole = "0", fraction = ""] = text.trim().replace(/^[-+]/, "").split(".");
  const digits = `${whole || "0"}${fraction.padEnd(decimals, "0").slice(0, decimals)}`;
  const magnitude = BigInt(digits);
  return negative ? -magnitude : magnitude;
}

/** The inverse of `toUnits`: 850n tenths → "85.0". */
export function fromUnits(value: bigint, decimals: number): string {
  const magnitude = value < 0n ? -value : value;
  const digits = magnitude.toString().padStart(decimals + 1, "0");
  const text = decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return value < 0n ? `-${text}` : text;
}

export const abs = (value: bigint): bigint => (value < 0n ? -value : value);
export const max = (...values: bigint[]): bigint => values.reduce((a, b) => (b > a ? b : a));
export const min = (...values: bigint[]): bigint => values.reduce((a, b) => (b < a ? b : a));

/** numerator / denominator, rounded half to even. */
export function divHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("division by zero");
  if (denominator < 0n) return divHalfEven(-numerator, -denominator);
  const quotient = numerator / denominator;              // truncates toward zero
  const remainder = numerator - quotient * denominator;
  const twice = abs(remainder) * 2n;
  if (twice < denominator) return quotient;
  const away = numerator < 0n ? quotient - 1n : quotient + 1n;
  if (twice > denominator) return away;
  return quotient % 2n === 0n ? quotient : away;
}

/** Basis points (1/100 of a percent) as a CSS percentage: 4170n → "41.70%". */
export const bpPercent = (bp: bigint): string => `${fromUnits(bp, 2)}%`;
