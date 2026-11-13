/** Exact decimals. Prices are bigint ten-thousandths of a dollar, money is bigint cents. */

export const PRICE_DECIMALS = 4;
const MONEY_DECIMALS = 2;

/** An exact decimal written as plain digits with an optional point, scaled to `decimals` places; null when it does not fit. */
export function parseDecimal(text: unknown, decimals: number): bigint | null {
  if (typeof text !== "string") return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1] + fraction.padEnd(decimals, "0"));
}

export function formatScaled(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

export const formatPrice = (units: bigint): string => formatScaled(units, PRICE_DECIMALS);
export const formatMoney = (cents: bigint): string => formatScaled(cents, MONEY_DECIMALS);

/** The integer nearest numerator ÷ denominator, halves rounded up. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function floorDivide(numerator: number, denominator: number): number {
  return (numerator - (numerator % denominator)) / denominator;
}

/** The exercise cost of `options` at a strike: options × strike, rounded half-up to the cent once. */
export function exerciseCostCents(options: number, strikeUnits: bigint): bigint {
  return roundHalfUp(BigInt(options) * strikeUnits, 10n ** BigInt(PRICE_DECIMALS - MONEY_DECIMALS));
}

/** numerator ÷ denominator × 100 as a two-decimal percentage string, halves rounded up. */
export function percentText(numerator: bigint | number, denominator: bigint | number): string {
  return formatScaled(roundHalfUp(BigInt(numerator) * 10000n, BigInt(denominator)), 2);
}

