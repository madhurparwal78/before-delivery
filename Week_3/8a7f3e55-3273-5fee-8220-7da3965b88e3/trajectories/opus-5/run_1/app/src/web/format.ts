const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Every timestamp from the API already carries the agency offset, so dates and times are
 * read straight out of the string and the browser's own zone never takes part.
 */
export function agencyDateOf(iso: string): string {
  return iso.slice(0, 10);
}

export function agencyTimeOf(iso: string): string {
  return iso.slice(11, 16);
}

export function weekdayShortOf(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number];
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[index] ?? 'Mon';
}

export function cutoffText(iso: string): string {
  const date = agencyDateOf(iso);
  return `${weekdayShortOf(date)} ${date} ${agencyTimeOf(iso)}`;
}

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}$${whole}.${fraction}`;
}

export function groupedCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function dateOnlyAddDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function countCodePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}
