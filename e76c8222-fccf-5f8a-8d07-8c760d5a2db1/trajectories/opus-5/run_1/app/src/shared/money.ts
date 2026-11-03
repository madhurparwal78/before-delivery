/** Money is handled as integer cents and shown as a dollar string with two decimals. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function parseMoney(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return dollars * 100 + Number(fraction);
}

/** Rounds a ratio of non-negative integers to the nearest integer, halves up. */
export function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Hours with two decimals, from a whole number of quarter hours. */
export function formatQuarterHours(quarters: number): string {
  return (quarters / 4).toFixed(2);
}

/** Hours with two decimals, from a whole number of minutes. */
export function formatMinutesAsHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}
