/**
 * Exact decimal arithmetic. Money is integer cents, per-share prices are integer
 * ten-thousandths of a dollar, percentages are integer hundredths of a percent.
 */
export const PRICE_SCALE = 10000n;
export const CENT_SCALE = 100n;

export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const doubled = numerator * 2n + denominator;
  const quotient = doubled / (denominator * 2n);
  return quotient;
}

export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  if (numerator % denominator !== 0n && numerator < 0n !== denominator < 0n) return quotient - 1n;
  return quotient;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return -floorDiv(-numerator, denominator);
}

/**
 * Parses a request decimal: plain digits with an optional decimal point, no sign,
 * spaces or exponent, with at most `decimals` digits after the point.
 */
export function parseDecimal(text: unknown, decimals: number): bigint | null {
  if (typeof text !== "string") return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return null;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const padded = fraction.padEnd(decimals, "0");
  return BigInt(whole + padded);
}

export function formatScaled(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const text = `${whole}.${String(fraction).padStart(decimals, "0")}`;
  return negative ? `-${text}` : text;
}

export function formatCents(cents: bigint): string {
  return formatScaled(cents, 2);
}

export function formatPrice(price: bigint): string {
  return formatScaled(price, 4);
}

export function formatPercent(hundredths: bigint): string {
  return formatScaled(hundredths, 2);
}

/** The exercise cost rule: options times strike, rounded half-up to the cent, once. */
export function exerciseCostCents(options: number, strikePrice: bigint): bigint {
  return roundHalfUp(BigInt(options) * strikePrice, PRICE_SCALE / CENT_SCALE);
}

/** A percentage of numerator/denominator, as hundredths of a percent, rounded half-up. */
export function percentHundredths(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return roundHalfUp(numerator * 10000n, denominator);
}

/** A ratio rounded half-up to two decimals, as hundredths. */
export function ratioHundredths(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return roundHalfUp(numerator * 100n, denominator);
}
