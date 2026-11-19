import {
  addDays,
  formatClockTime,
  instantsForWallClock,
  parseClockTime,
  type LibraryDate,
  type Weekday,
  wallClockAt,
  weekdayOf,
} from '../../shared/time';

export interface OpeningHours {
  readonly weekday: Weekday;
  readonly opens: string;
  readonly closes: string;
}

export interface Closure {
  readonly date: LibraryDate;
  readonly reason: string;
}

/** The opening calendar as it stands for one decision. */
export class OpeningCalendar {
  private readonly hoursByWeekday: Map<Weekday, OpeningHours>;
  private readonly closureDates: Set<LibraryDate>;

  constructor(
    readonly timeZone: string,
    hours: readonly OpeningHours[],
    closures: readonly Closure[],
  ) {
    this.hoursByWeekday = new Map(hours.map((entry) => [entry.weekday, entry]));
    this.closureDates = new Set(closures.map((entry) => entry.date));
  }

  hoursFor(weekday: Weekday): OpeningHours | null {
    return this.hoursByWeekday.get(weekday) ?? null;
  }

  /** A date whose weekday has opening hours and which is not a closure. */
  isOpenDay(date: LibraryDate): boolean {
    return this.hoursByWeekday.has(weekdayOf(date)) && !this.closureDates.has(date);
  }

  nextOpenDayOnOrAfter(date: LibraryDate): LibraryDate {
    let candidate = date;
    for (let step = 0; step < 4000; step += 1) {
      if (this.isOpenDay(candidate)) return candidate;
      candidate = addDays(candidate, 1);
    }
    throw new Error('The opening calendar has no open day within four thousand days');
  }

  nextOpenDayAfter(date: LibraryDate): LibraryDate {
    return this.nextOpenDayOnOrAfter(addDays(date, 1));
  }

  /** The closing time currently set for this date's weekday, as `HH:MM`. */
  closingTimeFor(date: LibraryDate): string | null {
    return this.hoursByWeekday.get(weekdayOf(date))?.closes ?? null;
  }

  /**
   * The instant `HH:MM:00` exactly on this date in library wall-clock time. When
   * the clocks repeat that wall-clock time, the first occurrence is the instant.
   */
  closingInstantFor(date: LibraryDate): Date | null {
    const closes = this.closingTimeFor(date);
    if (closes === null) return null;
    const minutes = parseClockTime(closes);
    if (minutes === null) return null;
    return instantsForWallClock(date, minutes * 60, this.timeZone)[0] ?? null;
  }

  /**
   * The day a return counts against: its own library date when that is an open
   * day and it arrived by the closing time, otherwise the next open day. The
   * cutoff is inclusive to the second, and is compared on library wall-clock
   * time, so both halves of a repeated hour count the same.
   */
  effectiveReturnDay(returnedAt: Date): LibraryDate {
    const clock = wallClockAt(returnedAt, this.timeZone);
    const closes = this.isOpenDay(clock.date) ? this.closingTimeFor(clock.date) : null;
    if (closes !== null) {
      const closingSecond = (parseClockTime(closes) ?? 0) * 60;
      if (clock.secondOfDay <= closingSecond) return clock.date;
    }
    return this.nextOpenDayAfter(clock.date);
  }

  /** Open days strictly after the due date, up to and including the return day. */
  openDaysLate(dueDate: LibraryDate, returnedAt: Date): number {
    const returnDay = this.effectiveReturnDay(returnedAt);
    if (returnDay <= dueDate) return 0;
    let count = 0;
    let candidate = addDays(dueDate, 1);
    while (candidate <= returnDay) {
      if (this.isOpenDay(candidate)) count += 1;
      candidate = addDays(candidate, 1);
    }
    return count;
  }

  /** The first open day on or after the checkout date plus the loan period. */
  dueDateFor(checkedOutAt: Date, loanPeriodDays: number): LibraryDate {
    const checkoutDay = wallClockAt(checkedOutAt, this.timeZone).date;
    return this.nextOpenDayOnOrAfter(addDays(checkoutDay, loanPeriodDays));
  }

  /** The next open days from today, for the calendar read. */
  nextOpenDays(fromDate: LibraryDate, count: number): LibraryDate[] {
    const days: LibraryDate[] = [];
    let candidate = fromDate;
    while (days.length < count) {
      candidate = this.nextOpenDayOnOrAfter(candidate);
      days.push(candidate);
      candidate = addDays(candidate, 1);
    }
    return days;
  }
}

export const QUARTER_HOUR_MESSAGE = 'Use a 24-hour time on the quarter hour, like 18:15.';
export const CLOSES_AFTER_OPENS_MESSAGE = 'Closing time must be later than opening time.';

export function isQuarterHour(text: string): boolean {
  const minutes = parseClockTime(text);
  return minutes !== null && minutes % 15 === 0 && formatClockTime(minutes) === text;
}
