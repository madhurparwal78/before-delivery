import {
  fromIso,
  isWeekday,
  toIso,
  weekdayAt,
  weekdaysBefore,
  type DayNumber,
  type IsoDate,
} from './dates.js';

/** The working-day calendar of one project: Monday to Friday, minus the project's holidays. */
export class Calendar {
  private readonly holidays: Set<DayNumber>;

  constructor(holidayDates: readonly IsoDate[]) {
    this.holidays = new Set(holidayDates.map(fromIso));
  }

  isWorkingDay(day: DayNumber): boolean {
    return isWeekday(day) && !this.holidays.has(day);
  }

  isWorkingIso(iso: IsoDate): boolean {
    return this.isWorkingDay(fromIso(iso));
  }

  nextWorkingDay(day: DayNumber): DayNumber {
    let d = day;
    while (!this.isWorkingDay(d)) d += 1;
    return d;
  }

  prevWorkingDay(day: DayNumber): DayNumber {
    let d = day;
    while (!this.isWorkingDay(d)) d -= 1;
    return d;
  }

  nextWorkingIso(iso: IsoDate): IsoDate {
    return toIso(this.nextWorkingDay(fromIso(iso)));
  }

  prevWorkingIso(iso: IsoDate): IsoDate {
    return toIso(this.prevWorkingDay(fromIso(iso)));
  }

  /** W(x): the count of working days strictly before this day. */
  index(day: DayNumber): number {
    let count = weekdaysBefore(day);
    for (const holiday of this.holidays) {
      if (holiday < day && isWeekday(holiday)) count -= 1;
    }
    return count;
  }

  indexOfIso(iso: IsoDate): number {
    return this.index(fromIso(iso));
  }

  /** The count of working days up to and including this day. */
  countUpTo(day: DayNumber): number {
    return this.index(day) + (this.isWorkingDay(day) ? 1 : 0);
  }

  countUpToIso(iso: IsoDate): number {
    return this.countUpTo(fromIso(iso));
  }

  /** The working day whose index is the given number. */
  at(index: number): DayNumber {
    let day = weekdayAt(index);
    for (;;) {
      if (!this.isWorkingDay(day)) {
        day = this.nextWorkingDay(day);
        continue;
      }
      const here = this.index(day);
      if (here === index) return day;
      day = here < index ? this.nextWorkingDay(day + 1) : this.prevWorkingDay(day - 1);
    }
  }

  isoAt(index: number): IsoDate {
    return toIso(this.at(index));
  }

  /**
   * The signed count of working days from `from` to `to`: positive when `to` is later,
   * counting the working days after `from` up to and including `to`.
   */
  signedWorkingDaysBetween(from: IsoDate, to: IsoDate): number {
    return this.countUpToIso(to) - this.countUpToIso(from);
  }
}
