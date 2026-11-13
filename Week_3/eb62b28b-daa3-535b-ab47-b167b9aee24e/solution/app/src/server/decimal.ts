// Exact decimal arithmetic on BigInt, for money and result values. Rounding is half up, away from zero.

interface Decimal {
  digits: bigint;
  scale: number;
}

const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

export function isDecimal(text: string): boolean {
  return DECIMAL.test(text);
}

export function parseDecimal(text: string): Decimal {
  const [whole = "0", fraction = ""] = text.replace(/^\+/, "").split(".");
  return { digits: BigInt(whole + fraction), scale: fraction.length };
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  const quotient = (top * 2n + bottom) / (bottom * 2n);
  return negative ? -quotient : quotient;
}

function formatScaled(digits: bigint, places: number): string {
  const negative = digits < 0n;
  const text = (negative ? -digits : digits).toString().padStart(places + 1, "0");
  const whole = text.slice(0, text.length - places);
  const fraction = places > 0 ? `.${text.slice(-places)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function rescaled(value: Decimal, places: number): bigint {
  return divideHalfUp(value.digits * 10n ** BigInt(places), 10n ** BigInt(value.scale));
}

// The published rounding: `value` to `places` decimals as a string.
export function roundedText(value: Decimal, places: number): string {
  return formatScaled(rescaled(value, places), places);
}

export function times(value: Decimal, factor: Decimal, places: number): string {
  const product = { digits: value.digits * factor.digits, scale: value.scale + factor.scale };
  return roundedText(product, places);
}

export function dividedBy(value: Decimal, factor: Decimal, places: number): string {
  const numerator = value.digits * 10n ** BigInt(factor.scale + places);
  const denominator = factor.digits * 10n ** BigInt(value.scale);
  return formatScaled(divideHalfUp(numerator, denominator), places);
}

export function compareDecimals(left: Decimal, right: Decimal): number {
  const scale = Math.max(left.scale, right.scale);
  const a = left.digits * 10n ** BigInt(scale - left.scale);
  const b = right.digits * 10n ** BigInt(scale - right.scale);
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Integer cents from a Kill Bill amount's decimal text.
export function centsFromAmount(amount: string): number {
  return Number(rescaled(parseDecimal(amount), 2));
}

// Integer cents as the decimal text Kill Bill's catalog reads.
export function amountText(cents: number): string {
  return formatScaled(BigInt(cents), 2);
}

// `cents × percent ÷ 100`, in integer cents.
export function percentOfCents(cents: number, percent: number): number {
  return Number(divideHalfUp(BigInt(cents) * BigInt(percent), 100n));
}

// `cents ÷ months`, in integer cents.
export function centsPerMonth(cents: number, months: number): number {
  return Number(divideHalfUp(BigInt(cents), BigInt(months)));
}
