/**
 * Derived display values. Hour figures and money are rounded half up with
 * integer arithmetic so the browser and the server always print the same digits.
 */

/** The minus sign used in every hour figure and pending line. */
export const MINUS = '\u2212';
export const EN_DASH = '\u2013';

/** Rounds `numerator / denominator` half up to a whole number. */
function roundHalfUp(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  const whole = Math.floor(absolute / denominator);
  const remainder = absolute - whole * denominator;
  return sign * (remainder * 2 >= denominator ? whole + 1 : whole);
}

/** `<hours>`: minutes / 60, rounded half up to two decimals, always two decimals. */
export function formatHours(minutes: number): string {
  const hundredths = roundHalfUp(Math.abs(minutes) * 5, 3);
  const sign = minutes < 0 ? MINUS : '';
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths - whole * 100;
  return `${sign}${whole}.${fraction < 10 ? '0' : ''}${fraction}`;
}

/** A ledger row's Hours cell: `+<hours>` or `−<hours>`. */
export function formatSignedHours(minutes: number): string {
  return minutes < 0 ? `${MINUS}${formatHours(-minutes)}` : `+${formatHours(minutes)}`;
}

/** Parses a `"0.00"` money string into whole cents. */
export function moneyToCents(money: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(money);
  if (!match) throw new Error(`not a money string: ${money}`);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + Number(fraction);
}

export function centsToMoney(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = cents - whole * 100;
  return `${whole}.${fraction < 10 ? '0' : ''}${fraction}`;
}

/**
 * `overage_units` x the booking's own hourly overage rate / 4, rounded half up
 * to cents.
 */
export function overageUsd(units: number, ratePerHour: string): string {
  return centsToMoney(roundHalfUp(units * moneyToCents(ratePerHour), 4));
}
