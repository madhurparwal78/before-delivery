/** Money is carried as integer cents; no amount ever passes through a float. */
export type Cents = bigint;

export function parseDollars(text: string): Cents | null {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/.exec(text);
  if (!match) return null;
  return BigInt(match[1] as string) * 100n + BigInt(match[2] as string);
}

export function formatDollars(cents: Cents): string {
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Divides by `divisor`, rounding half up. Operands are non-negative. */
export function divideHalfUp(value: bigint, divisor: bigint): bigint {
  return (value * 2n + divisor) / (divisor * 2n);
}
