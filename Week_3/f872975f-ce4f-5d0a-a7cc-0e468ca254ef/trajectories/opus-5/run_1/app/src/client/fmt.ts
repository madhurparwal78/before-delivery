import { Unit, formatLength } from '../shared/units';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A server timestamp in UTC: day, three-letter month, year, 24-hour time, seconds dropped. */
export function formatInstant(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const day = at.getUTCDate();
  const month = MONTHS[at.getUTCMonth()] ?? '';
  const hours = String(at.getUTCHours()).padStart(2, '0');
  const minutes = String(at.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${at.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

/** Dollars with two decimals and comma thousands separators. */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const total = Math.abs(cents);
  const whole = Math.trunc(total / 100).toLocaleString('en-US');
  const rest = String(total % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${rest}`;
}

export const length = (mm: number, unit: Unit): string => formatLength(mm, unit);

export function dimensions(lengthMm: number, widthMm: number, thicknessMm: number, unit: Unit): string {
  return `${formatLength(lengthMm, unit)} × ${formatLength(widthMm, unit)} × ${formatLength(thicknessMm, unit)}`;
}

export function boardCountSentence(count: number): string {
  if (count === 0) return 'No boards match these filters';
  if (count === 1) return '1 board on the rack';
  return `${count} boards on the rack`;
}
