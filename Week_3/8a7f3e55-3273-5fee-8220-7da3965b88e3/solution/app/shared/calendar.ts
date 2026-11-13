/** Agency-local calendar dates as `YYYY-MM-DD` text; pure date arithmetic, no time zone and no clock. */
export type LocalDate = string;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function parseLocalDate(text: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  const real = check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

export const isDate = (text: string): boolean => parseLocalDate(text) !== null;

function utcMsOf(date: LocalDate): number {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new Error(`not a date: ${date}`);
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

export function addDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(utcMsOf(date) + days * DAY_MS);
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

export const daysBetween = (from: LocalDate, to: LocalDate): number => Math.round((utcMsOf(to) - utcMsOf(from)) / DAY_MS);

/** 0 = Monday ... 6 = Sunday */
export const weekdayIndex = (date: LocalDate): number => (new Date(utcMsOf(date)).getUTCDay() + 6) % 7;

export const mondayOf = (date: LocalDate): LocalDate => addDays(date, -weekdayIndex(date));
