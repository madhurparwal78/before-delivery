// Calendar days as plain year, month and day: the date picker's arithmetic. The server decides which day is today.

export interface Day { year: number; month: number; day: number }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const MS_PER_DAY = 86_400_000;

const toUtc = (day: Day): Date => new Date(Date.UTC(day.year, day.month - 1, day.day));
const fromUtc = (date: Date): Day => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? '';

export const compareDays = (a: Day, b: Day): number => a.year - b.year || a.month - b.month || a.day - b.day;
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** Monday is 0. */
export const weekdayIndex = (day: Day): number => (toUtc(day).getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
export const addDays = (day: Day, count: number): Day => fromUtc(new Date(toUtc(day).getTime() + count * MS_PER_DAY));

export function addMonths(day: Day, count: number): Day {
  const index = day.year * MONTHS_PER_YEAR + day.month - 1 + count;
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = (index % MONTHS_PER_YEAR) + 1;
  return { year, month, day: Math.min(day.day, daysInMonth(year, month)) };
}

/** A real day written YYYY-MM-DD, or null. */
export function parseDay(text: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const day = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return compareDays(fromUtc(toUtc(day)), day) === 0 ? day : null;
}

export function requireDay(text: string): Day {
  const day = parseDay(text);
  if (!day) throw new Error(`The server sent ${text}, which is not a day.`);
  return day;
}

export const formatDay = (day: Day): string =>
  `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;

/** The calendar's grid name, like `March 2026`. */
export const monthTitle = (day: Day): string => `${monthName(day.month)} ${day.year}`;

/** A calendar cell's name, like `14 March 2026`. */
export const dayTitle = (day: Day): string => `${day.day} ${monthName(day.month)} ${day.year}`;
