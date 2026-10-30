/** Presentation of money, hours and durations. Money is carried as integer cents. */

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** Decimal hours with two decimals, for example `3.75`. */
export function formatHours(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const absolute = Math.abs(minutes);
  const hundredths = Math.round((absolute * 100) / 60);
  return `${sign}${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/** A duration as `<h>:<mm>`, for example `1:30`. */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Rounds a rational number of cents half up, using integer arithmetic only. */
export function roundHalfUpCents(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  return sign * Math.floor((2 * absolute + denominator) / (2 * denominator));
}
