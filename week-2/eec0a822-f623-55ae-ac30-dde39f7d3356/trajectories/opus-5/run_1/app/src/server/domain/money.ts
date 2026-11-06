export interface Decimal {
  readonly digits: bigint;
  readonly scale: number;
}

/** Rounds a positive quotient half up, in exact integer arithmetic. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function parseDecimal(value: string): Decimal {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) throw new Error(`Not a decimal: ${value}`);
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1] + fraction), scale: fraction.length };
}

export function isDecimalString(value: string, maxDecimals: number): boolean {
  const match = /^(\d+)(?:\.(\d{1,}))?$/.exec(value.trim());
  if (match === null) return false;
  return (match[2] ?? '').length <= maxDecimals;
}

export function decimalAboveZero(value: string): boolean {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return false;
  return BigInt(match[1] + (match[2] ?? '')) > 0n;
}

/** Converts a minor-unit amount by an exchange rate, rounded half up. */
export function convertMinor(eurMinor: bigint, rate: Decimal): bigint {
  return roundHalfUp(eurMinor * rate.digits, 10n ** BigInt(rate.scale));
}

export function percentOfMinor(minor: bigint, percent: bigint): bigint {
  return roundHalfUp(minor * percent, 100n);
}

export function formatDecimalString(value: Decimal): string {
  if (value.scale === 0) return value.digits.toString();
  const digits = value.digits.toString().padStart(value.scale + 1, '0');
  return `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
}

export function majorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
