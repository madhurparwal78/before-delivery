import { DateTime } from 'luxon';

export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  prepared: 'Prepared',
  client_approved: 'Client approved',
  filed: 'Filed',
  packeted: 'Packeted',
  amended: 'Amended',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `Monday June 22`, full words, no comma. */
export function dateLine(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAY_NAMES[dt.getUTCDay()]} ${MONTH_NAMES[m - 1]} ${d}`;
}

export function periodLabel(period: string): string {
  if (period.length === 4) return period;
  if (period.includes('Q')) return `${period.slice(5)} ${period.slice(0, 4)}`;
  return `${MONTH_NAMES[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
}

/** `<h:mm am/pm>` in the practice zone. */
export function centralTimeLabel(date: Date): string {
  const dt = DateTime.fromJSDate(date, { zone: 'America/Chicago' });
  const hour = dt.hour === 0 ? 12 : dt.hour > 12 ? dt.hour - 12 : dt.hour;
  const ampm = dt.hour < 12 ? 'am' : 'pm';
  return `${hour}:${String(dt.minute).padStart(2, '0')} ${ampm}`;
}
