/** Money is handled in whole cents everywhere; strings with two decimals cross the wire. */

const MONEY_PATTERN = /^(0|[1-9][0-9]*)\.[0-9]{2}$/;

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function parseMoney(value: unknown): number | null {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) return null;
  const [whole, fraction] = value.split('.');
  if (whole === undefined || fraction === undefined) return null;
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
}

/** Percentages travel as strings with two decimals and are held as hundredths of a percent. */
const PERCENT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

export function formatPercent(hundredths: number): string {
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

export function parsePercent(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !PERCENT_PATTERN.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (whole === undefined) return null;
  const hundredths = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  if (hundredths > 10000) return null;
  return hundredths;
}

/**
 * floor(amount * numerator / denominator) over whole numbers only: the remainder is
 * subtracted first so the division is exact and never rounds.
 */
export function floorShare(amountCents: number, numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const product = amountCents * numerator;
  const remainder = product % denominator;
  return (product - remainder) / denominator;
}
