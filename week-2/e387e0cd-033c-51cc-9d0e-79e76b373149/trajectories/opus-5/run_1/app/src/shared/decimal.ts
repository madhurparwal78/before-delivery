/**
 * Exact decimal arithmetic on scaled BigInt values. Money and crypto amounts
 * never pass through binary floating point.
 */

const TEN = 10n;

export function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** Division that rounds a non-negative quotient half away from zero. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

const DECIMAL_SHAPE = /^(0|[1-9][0-9]*)(\.([0-9]+))?$/;

/** Parses a plain decimal string into a value scaled by 10^decimals. */
export function parseScaled(input: string, decimals: number): bigint | null {
  const match = DECIMAL_SHAPE.exec(input);
  if (match === null) return null;
  const fraction = match[3] ?? '';
  if (fraction.length > decimals) return null;
  const padded = fraction.padEnd(decimals, '0');
  return BigInt(match[1] + padded);
}

/** Renders a scaled value with exactly `decimals` decimal places. */
export function formatScaled(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, '0');
  return `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`;
}

/** Integer cents rendered with exactly two decimals and no thousands separator. */
export function centsToPlainDecimal(cents: bigint): string {
  return formatScaled(cents, 2);
}

/**
 * The exact product of a crypto amount and an integer-cents rate per whole
 * unit, rounded half up to a whole cent.
 */
export function fiatValueCents(amountScaled: bigint, decimals: number, rateCents: bigint): bigint {
  return divRoundHalfUp(amountScaled * rateCents, pow10(decimals));
}

/**
 * The exact product of a whole count and a unit price given with four decimal
 * places, rounded half up to whole cents.
 */
export function lineAmountCents(count: number, unitPriceScaled4: bigint): bigint {
  return divRoundHalfUp(BigInt(count) * unitPriceScaled4, pow10(2));
}
