/** Dollars with two decimals and thousands commas, from integer cents. */
export function formatUsd(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(remainder).padStart(2, '0')}`;
}

/** A written sign and word label, so an amount never relies on colour alone. */
export function signedAmountLabel(cents: number, kind: 'credit' | 'debit' | 'refund'): string {
  const sign = cents < 0 ? '\u2212' : '+';
  return `${sign}${formatUsd(Math.abs(cents))} ${kind}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `YYYY-MM` as `Month YYYY`, for statement labels. */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  const index = Number.parseInt(month ?? '', 10) - 1;
  const name = MONTH_NAMES[index];
  return name && year ? `${name} ${year}` : period;
}

export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
