export const UK_ZONE = 'Europe/London';

export type LocalDateTime = { date: string; time: string; repeatedHour?: 'first' | 'second' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallPartsAt(ms: number): WallParts {
  const parts = partsFormat.formatToParts(new Date(ms));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Minutes the UK clock is ahead of UTC at an instant: 0 in GMT, 60 in BST. */
export function ukOffsetMinutes(ms: number): number {
  const p = wallPartsAt(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function isTimeString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h <= 23 && m <= 59;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The two readings of a wall time, in order: first (BST) then second (GMT). Empty in the missing hour. */
export function instantsForWall(date: string, time: string): number[] {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const found: number[] = [];
  for (const offset of [60, 0]) {
    const ms = wallAsUtc - offset * 60000;
    if (ukOffsetMinutes(ms) === offset) found.push(ms);
  }
  return found;
}

export type WallReading = { instant: number; ambiguous: boolean } | null;

export function readWall(local: LocalDateTime): WallReading {
  const found = instantsForWall(local.date, local.time);
  if (found.length === 0) return null;
  if (found.length === 1) return { instant: found[0], ambiguous: false };
  const pick = local.repeatedHour === 'second' ? found[1] : found[0];
  return { instant: pick, ambiguous: true };
}

export function wallIsMissing(date: string, time: string): boolean {
  return instantsForWall(date, time).length === 0;
}

export function wallIsRepeated(date: string, time: string): boolean {
  return instantsForWall(date, time).length === 2;
}

export function ukDateOf(ms: number): string {
  const p = wallPartsAt(ms);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function ukTimeOf(ms: number): string {
  const p = wallPartsAt(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function ukLocalOf(ms: number): LocalDateTime {
  return { date: ukDateOf(ms), time: ukTimeOf(ms) };
}

export function instantString(ms: number): string {
  return `${new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

export function dateNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dateFromNumber(value: number): string {
  const when = new Date(value);
  return `${String(when.getUTCFullYear()).padStart(4, '0')}-${String(when.getUTCMonth() + 1).padStart(2, '0')}-${String(when.getUTCDate()).padStart(2, '0')}`;
}

/** Whole UK calendar days from one date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateNumber(to) - dateNumber(from)) / 86400000);
}

export function addDays(date: string, days: number): string {
  return dateFromNumber(dateNumber(date) + days * 86400000);
}

export function weekdayOf(date: string): number {
  return new Date(dateNumber(date)).getUTCDay();
}

/** The start of a UK calendar day as an instant. */
export function startOfUkDay(date: string): number {
  const found = instantsForWall(date, '00:00');
  if (found.length > 0) return found[0];
  return instantsForWall(date, '01:00')[0];
}

export function endOfUkDayInstant(date: string): number {
  return startOfUkDay(addDays(date, 1)) - 1000;
}

export function ukHoursInDay(date: string): number {
  return Math.round((startOfUkDay(addDays(date, 1)) - startOfUkDay(date)) / 3600000);
}

export function clockChangeLabel(date: string): string | null {
  const hours = ukHoursInDay(date);
  if (hours === 23) return 'Clocks go forward 01:00';
  if (hours === 25) return 'Clocks go back 02:00';
  return null;
}

/** Formats a UK date as `Mon 29 Mar 2027`. */
export function formatUkDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[weekdayOf(date)];
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatDateForLanguage(date: string, language: 'en' | 'pl' | 'ur'): string {
  const [y, m, d] = date.split('-').map(Number);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  if (language === 'pl') return `${dd}.${mm}.${y}`;
  if (language === 'ur') return `${dd}/${mm}/${y}`;
  return formatUkDate(date);
}

export function formatUkDateTime(ms: number): string {
  return `${formatUkDate(ukDateOf(ms))}, ${ukTimeOf(ms)} UK time`;
}

/** The UK time of an instant with its minute rounded up, for rate-limit copy. */
export function ukTimeRoundedUp(ms: number): string {
  const rounded = Math.ceil(ms / 60000) * 60000;
  return ukTimeOf(rounded);
}

export function localLabel(local: LocalDateTime | null): string {
  if (!local) return '';
  const suffix = local.repeatedHour ? (local.repeatedHour === 'second' ? ' (GMT)' : ' (BST)') : '';
  return `${formatUkDate(local.date)}, ${local.time}${suffix}`;
}

export function isoWeekOf(date: string): string {
  const base = new Date(dateNumber(date));
  const day = (base.getUTCDay() + 6) % 7;
  base.setUTCDate(base.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(base.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((base.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${base.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The Monday of the ISO week, or null for a week that is not a week. */
export function mondayOfIsoWeek(week: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[2]);
  if (number < 1 || number > 53) return null;
  const fourth = new Date(Date.UTC(year, 0, 4));
  const day = (fourth.getUTCDay() + 6) % 7;
  const monday = new Date(fourth.getTime() - day * 86400000 + (number - 1) * 7 * 86400000);
  const date = dateFromNumber(monday.getTime());
  if (isoWeekOf(date) !== week) return null;
  return date;
}

export function mondayOfWeekContaining(date: string): string {
  const day = (weekdayOf(date) + 6) % 7;
  return addDays(date, -day);
}
