// Working-day calendar: the one place that decides what a working day is.

const MS_DAY = 86_400_000;
/** 1970-01-01 is working-day number 1. */
const WORKDAY_ANCHOR: IsoDate = '1970-01-01';

export type IsoDate = string;

export class WorkingCalendar {
  private readonly holidays: Set<IsoDate>;

  constructor(holidays: readonly IsoDate[]) {
    this.holidays = new Set(holidays);
  }

  isWorking(date: IsoDate): boolean {
    const dow = weekday(date);
    return dow >= 1 && dow <= 5 && !this.holidays.has(date);
  }

  nextWorking(date: IsoDate): IsoDate {
    let d = date;
    let guard = 0;
    while (!this.isWorking(d) && guard < 400) {
      d = addDays(d, 1);
      guard += 1;
    }
    return d;
  }

  previousWorking(date: IsoDate): IsoDate {
    let d = date;
    let guard = 0;
    while (!this.isWorking(d) && guard < 400) {
      d = addDays(d, -1);
      guard += 1;
    }
    return d;
  }

  /** Count of working days strictly after `from` up to and including `to`; negative in the other direction. */
  workDiff(from: IsoDate, to: IsoDate): number {
    if (from === to) return 0;
    const a = toEpoch(from);
    const b = toEpoch(to);
    const step = b > a ? 1 : -1;
    let count = 0;
    for (let d = a + step; ; d += step) {
      if (this.isWorking(fromEpoch(d))) count += step;
      if (d === b) break;
    }
    return count;
  }

  /** Working-day number of a calendar day: the number of its next working day. */
  workingNumber(date: IsoDate): number {
    return this.workDiff(WORKDAY_ANCHOR, this.nextWorking(date)) + 1;
  }

  /** The calendar date of working-day number `n`. */
  workingDay(n: number): IsoDate {
    return this.addWorkdays(WORKDAY_ANCHOR, n - 1);
  }

  /** `n` working days after (or before, for negative `n`) a calendar day. */
  addWorkdays(date: IsoDate, n: number): IsoDate {
    if (n === 0) return this.nextWorking(date);
    if (n > 0) {
      let iso = this.nextWorking(date);
      let left = n;
      while (left > 0) {
        iso = addDays(iso, 1);
        if (this.isWorking(iso)) left -= 1;
      }
      return iso;
    }
    let iso = this.previousWorking(date);
    let left = -n;
    while (left > 0) {
      iso = addDays(iso, -1);
      if (this.isWorking(iso)) left -= 1;
    }
    return iso;
  }

  /** Working days from `start` to `end` inclusive, both assumed working days. */
  spanDuration(start: IsoDate, end: IsoDate): number {
    if (end < start) return 0;
    return this.workDiff(start, end) + 1;
  }
}

export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toEpoch(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_DAY;
}

export function fromEpoch(epochDay: number): IsoDate {
  const dt = new Date(epochDay * MS_DAY);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return fromEpoch(toEpoch(date) + n);
}

export function weekday(date: IsoDate): number {
  const dow = new Date(toEpoch(date) * MS_DAY).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `Mon 1 Mar 2027`. */
export function longDate(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** `Mon 1 Mar`. */
export function shortDate(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]}`;
}
