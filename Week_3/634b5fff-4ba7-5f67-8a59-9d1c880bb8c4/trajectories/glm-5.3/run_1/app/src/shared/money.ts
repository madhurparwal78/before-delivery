/** Divide exactly with half-up rounding: round(a / b). The one rounding rule. */
export function divideRound(amount: number, divisor: number): number {
  const negative = amount < 0;
  const mag = negative ? -amount : amount;
  const q = Math.floor(mag / divisor);
  const twiceRem = (mag % divisor) * 2;
  const result = q + (twiceRem >= divisor ? 1 : 0);
  return negative ? -result : result;
}

/** Multiply by a basis-point rate with half-up rounding: round(a * bps / 10000). */
export function applyBps(amount: number, bps: number): number {
  return divideRound(amount * bps, 10_000);
}

/** Format integer øre as kroner with a thousands comma and two decimals. */
export function formatOre(ore: number): string {
  const sign = ore < 0 ? '-' : '';
  const mag = Math.abs(ore);
  const kroner = Math.floor(mag / 100);
  const cents = mag % 100;
  const withCommas = kroner.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${withCommas}.${cents.toString().padStart(2, '0')}`;
}
