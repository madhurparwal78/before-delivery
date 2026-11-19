export type IsoDate = string;

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIRST_MONDAY = 4;
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;

function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function dayNumber(date: IsoDate): number {
  return daysFromCivil(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));
}

function dateOfDay(days: number): IsoDate {
  const { year, month, day } = civilFromDays(days);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isIsoDate(text: unknown): text is IsoDate {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  return year >= FIRST_YEAR && year <= LAST_YEAR && dateOfDay(dayNumber(text)) === text;
}

export function weekdayIndex(date: IsoDate): number {
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return dateOfDay(dayNumber(date) + days);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

export function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date));
}

export function formatShort(date: IsoDate): string {
  const { month, day } = civilFromDays(dayNumber(date));
  return `${WEEKDAY_NAMES[weekdayIndex(date)]} ${day} ${MONTH_NAMES[month - 1]}`;
}

export function formatLong(date: IsoDate): string {
  return `${formatShort(date)} ${date.slice(0, 4)}`;
}

export function monthYearLabel(date: IsoDate): string {
  const { month, year } = civilFromDays(dayNumber(date));
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function dayOfMonth(date: IsoDate): number {
  return civilFromDays(dayNumber(date)).day;
}

export function weekdayLetter(date: IsoDate): string {
  return WEEKDAY_NAMES[weekdayIndex(date)].slice(0, 1);
}

/** The project's working-day calendar: Monday to Friday minus its own holidays. */
export class WorkCalendar {
  private readonly holidayDays: number[];

  constructor(holidays: readonly IsoDate[]) {
    this.holidayDays = holidays
      .map(dayNumber)
      .filter((days) => days >= FIRST_MONDAY && this.isWeekday(days))
      .sort((a, b) => a - b);
  }

  private isWeekday(days: number): boolean {
    return (((days + 3) % 7) + 7) % 7 < 5;
  }

  private holidaysThrough(days: number): number {
    let low = 0;
    let high = this.holidayDays.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.holidayDays[middle] <= days) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  isWorking(date: IsoDate): boolean {
    const days = dayNumber(date);
    return this.isWeekday(days) && this.holidaysThrough(days) === this.holidaysThrough(days - 1);
  }

  /** W(x): the number of working days up to and including `date`; a working day's own number. */
  workingDayNumber(date: IsoDate): number {
    const days = dayNumber(date) - FIRST_MONDAY + 1;
    const weekdays = Math.floor(days / 7) * 5 + Math.min(days % 7, 5);
    return weekdays - this.holidaysThrough(dayNumber(date));
  }

  dateOfWorkingDay(number: number): IsoDate {
    let low = FIRST_MONDAY;
    let high = FIRST_MONDAY + Math.ceil((number + this.holidayDays.length) / 5) * 7 + 7;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.workingDayNumber(dateOfDay(middle)) >= number) high = middle;
      else low = middle + 1;
    }
    return dateOfDay(low);
  }

  nextWorking(date: IsoDate): IsoDate {
    return this.isWorking(date) ? date : this.dateOfWorkingDay(this.workingDayNumber(date) + 1);
  }

  previousWorking(date: IsoDate): IsoDate {
    return this.isWorking(date) ? date : this.dateOfWorkingDay(this.workingDayNumber(date));
  }

  /** The working day `count` working days after (or before, when negative) a working `date`. */
  shiftWorking(date: IsoDate, count: number): IsoDate {
    return this.dateOfWorkingDay(this.workingDayNumber(date) + count);
  }

  /** Working days from `start` to `end`, both counted. */
  workingSpan(start: IsoDate, end: IsoDate): number {
    return this.workingDayNumber(end) - this.workingDayNumber(start) + 1;
  }
}
