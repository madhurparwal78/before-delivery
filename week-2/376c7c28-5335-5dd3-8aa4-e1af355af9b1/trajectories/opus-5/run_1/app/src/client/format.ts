import { MONTH_NAMES, WEEKDAY_NAMES } from '../shared/labels.ts';

/** Dollars built from integer cents, so money never passes through a float. */
export function dollars(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(abs / 100);
  const part = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(part).padStart(2, '0')}`;
}

export function money(cents: number): string {
  return cents < 0 ? `-$${dollars(-cents)}` : `$${dollars(cents)}`;
}

/** Dollars typed by a person, read as integer cents. */
export function centsFromDollarText(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed) && !/^-?\.\d{1,2}$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [whole = '', fraction = ''] = digits.split('.');
  const cents =
    Number.parseInt(whole === '' ? '0' : whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  return negative ? -cents : cents;
}

export function studioDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map((piece) => Number.parseInt(piece, 10));
  const probe = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  return `${WEEKDAY_NAMES[probe.getUTCDay()] as string} ${d} ${
    MONTH_NAMES[(m as number) - 1] as string
  } ${y}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map((piece) => Number.parseInt(piece, 10));
  return `${MONTH_NAMES[(m as number) - 1] as string} ${y}`;
}

