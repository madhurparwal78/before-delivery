const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function utc(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function iso(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function isValidDate(text: unknown): text is string {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return iso(utc(text)) === text;
}

export const addDays = (date: string, days: number): string => iso(utc(date) + days * DAY_MS);
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS);

/** Monday is 0. */
export const weekdayIndex = (date: string): number => (new Date(utc(date)).getUTCDay() + 6) % 7;
const mondayOf = (date: string): string => addDays(date, -weekdayIndex(date));

export function isoWeekOf(date: string): string {
  const thursday = addDays(mondayOf(date), 3);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function isValidWeek(text: unknown): text is string {
  if (typeof text !== 'string' || !/^\d{4}-W\d{2}$/.test(text)) return false;
  return isoWeekOf(mondayOfWeek(text)) === text;
}

export function mondayOfWeek(week: string): string {
  const [year, number] = week.split('-W').map(Number) as [number, number];
  const fourthOfJanuary = `${year}-01-04`;
  return addDays(mondayOf(fourthOfJanuary), (number - 1) * 7);
}

export function listDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** `Thu 5 Nov` */
export function dayLabel(date: string): string {
  const d = new Date(utc(date));
  return `${WEEKDAYS[weekdayIndex(date)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** `Thu 5 Nov 2026` */
export const longDayLabel = (date: string): string => `${dayLabel(date)} ${date.slice(0, 4)}`;

/** `2 Nov 2026` */
export function mondayLabel(date: string): string {
  const d = new Date(utc(date));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const shortMonthDay = (date: string): string => {
  const d = new Date(utc(date));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
