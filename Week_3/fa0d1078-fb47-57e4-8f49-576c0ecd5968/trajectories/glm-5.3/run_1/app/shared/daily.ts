// The daily calendar rules. Today is the server clock's date in DAILY_TZ; the
// calendar starts at DAILY_START. The daily puzzle for date D is daily-k, with
// k = (days from 2026-01-01 to D) mod 7 + 1.

export const DAILY_EPOCH = '2026-01-01';

export function ymdToUtc(date: string): number {
  // A yyyy-mm-dd string to a UTC day number, for day arithmetic only.
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function utcToYmd(day: number): string {
  const d = new Date(day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return ymdToUtc(to) - ymdToUtc(from);
}

export function dailyPuzzleIndex(date: string): number {
  const n = daysBetween(DAILY_EPOCH, date);
  return ((n % 7) + 7) % 7 + 1;
}

export type DailyPuzzleId = `daily-${number}`;

export function dailyPuzzleId(date: string): DailyPuzzleId {
  return `daily-${dailyPuzzleIndex(date)}` as DailyPuzzleId;
}

// A date string like 2026-11-03 is valid when it names a real calendar date.
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isMonthString(s: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5));
  return m >= 1 && m <= 12;
}

// The current streak counts consecutive solved dates, ending today if today is
// solved, else ending yesterday. A late date never counts, and a missed or
// late date ends a run. The best streak is the longest such run ever.
export interface DayState {
  date: string;
  state: 'solved' | 'late' | 'missed' | 'today' | 'future' | 'closed';
}

export function streaks(days: ReadonlyArray<{ date: string; state: string }>, today: string): { current: number; best: number } {
  const byDate = new Map(days.map((d) => [d.date, d.state]));
  let current = 0;
  const todayState = byDate.get(today);
  let cursor = todayState === 'solved' ? today : shiftDate(today, -1);
  while (byDate.get(cursor) === 'solved') {
    current++;
    cursor = shiftDate(cursor, -1);
  }
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (d.state === 'solved') {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return { current, best };
}

export function shiftDate(date: string, delta: number): string {
  return utcToYmd(ymdToUtc(date) + delta);
}

// The month grid: weeks are rows starting on Monday. Each date cell has
// data-date, data-state and an aria-label; the neighbouring months' days are
// blank cells.
export interface MonthGrid {
  year: number;
  month: number; // 1 to 12
  weeks: Array<Array<string | null>>; // date strings, null for blanks
}

export function monthGrid(year: number, month: number): MonthGrid {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Monday-based weekday of the 1st.
  const lead = (first.getUTCDay() + 6) % 7;
  const weeks: Array<Array<string | null>> = [];
  let week: Array<string | null> = new Array(lead).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    week.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return { year, month, weeks };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1];
}

export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${monthName(m)} ${d}, ${y}`;
}
