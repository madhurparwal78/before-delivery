const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 h", "2 h 30", "30 min", "0 min" */
export function formatDuration(minutes: number): string {
  if (minutes === 0) return '0 min';
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${sign}${mins} min`;
  if (mins === 0) return `${sign}${hours} h`;
  return `${sign}${hours} h ${String(mins).padStart(2, '0')}`;
}

/** "Wed 28 Oct 2026" from a kitchen-local YYYY-MM-DD */
export function formatDateLabel(date: string): string {
  const [y, m, d] = splitDate(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  return `${weekday} ${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

export function splitDate(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** Kitchen-local date part of an ISO time carrying the kitchen offset. */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Kitchen-local HH:MM of an ISO time carrying the kitchen offset. */
export function isoTime(iso: string): string {
  return iso.slice(11, 16);
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = splitDate(from);
  const [ty, tm, td] = splitDate(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = splitDate(value);
  if (m < 1 || m > 12 || d < 1) return false;
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

export function minutesOfHhmm(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function hhmmOfMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isHalfHourHhmm(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const minutes = minutesOfHhmm(value);
  return minutes % 30 === 0 && minutes >= 0 && minutes <= 24 * 60;
}
