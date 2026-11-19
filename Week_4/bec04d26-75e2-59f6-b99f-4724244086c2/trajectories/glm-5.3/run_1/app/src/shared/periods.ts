import { DateTime } from 'luxon';

export const PRACTICE_ZONE = 'America/Chicago';

const ZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific',
  'Pacific/Honolulu': 'Hawaii',
};

export function zoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? zone;
}

export type Frequency = 'monthly' | 'quarterly' | 'yearly';

export const PERIOD_RE = /^(\d{4})(?:-(\d{2})|(Q[1-4]))$/;

export function periodStart(period: string): { year: number; month: number } {
  const match = PERIOD_RE.exec(period);
  if (!match || (match[2] !== undefined && match[2] !== 'Q' && (Number(match[2]) < 1 || Number(match[2]) > 12))) {
    throw new Error(`bad period ${period}`);
  }
  if (match[2] !== undefined) return { year: Number(match[1]), month: Number(match[2]) };
  return { year: Number(match[1]), month: (Number(match[3][1]) - 1) * 3 + 1 };
}

export function periodLabel(period: string): string {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new Error(`bad period ${period}`);
  if (match[3] !== undefined) return `${match[3]} ${match[1]}`;
  if (match[2] !== undefined) return `${monthName(Number(match[2]))} ${match[1]}`;
  return match[1];
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Date line like `Monday June 22`, no comma. */
export function dateLine(date: string): string {
  const dt = DateTime.fromISO(date, { zone: 'utc' });
  return `${WEEKDAYS[dt.weekday % 7]} ${monthName(dt.month)} ${dt.day}`;
}

export function firstDayOfPeriod(period: string): string {
  const { year, month } = periodStart(period);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Month after the period (monthly or quarterly), or January after the year. */
export function monthAfterPeriod(period: string): { year: number; month: number } {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new Error(`bad period ${period}`);
  const year = Number(match[1]);
  if (match[3] !== undefined) {
    const quarter = Number(match[3][1]);
    return quarter === 4 ? { year: year + 1, month: 1 } : { year, month: quarter * 3 + 1 };
  }
  if (match[2] !== undefined) {
    const month = Number(match[2]);
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  }
  return { year: year + 1, month: 1 };
}

/** The sequence of periods a registration generates, starting at firstPeriod. */
export function generatedPeriods(frequency: Frequency, firstPeriod: string): string[] {
  const match = PERIOD_RE.exec(firstPeriod);
  if (!match) throw new Error(`bad period ${firstPeriod}`);
  const year = Number(match[1]);
  if (frequency === 'yearly') return [`${year}`];
  const total = frequency === 'monthly' ? 12 : 4;
  const periods: string[] = [];
  let cursor: { year: number; month: number };
  if (match[2] !== undefined) {
    cursor = { year, month: Number(match[2]) };
  } else {
    const quarter = Number(match[3][1]);
    cursor = { year, month: (quarter - 1) * 3 + 1 };
  }
  for (let i = 0; i < total; i++) {
    periods.push(`${cursor.year}-${String(cursor.month).padStart(2, '0')}`);
    cursor = cursor.month === 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: cursor.month + 1 };
    if (frequency === 'quarterly') cursor = nextQuarterStart(cursor);
  }
  return periods;
}

function nextQuarterStart(cursor: { year: number; month: number }): { year: number; month: number } {
  // from a month-of-quarter start, add 3 months
  const monthIndex = cursor.month - 1;
  const next = (monthIndex + 3) % 12;
  const yearAdd = Math.floor((monthIndex + 3) / 12);
  return { year: cursor.year + yearAdd, month: next + 1 };
}
