/** Date-only arithmetic on integer day numbers (days since 1970-01-01), free of time zones. */

export type DayNumber = number;
export type IsoDate = string;

const WEEKDAY_EPOCH = 4; // 1970-01-05, a Monday

export function daysFromCivil(year: number, month: number, day: number): DayNumber {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(dayNumber: DayNumber): { year: number; month: number; day: number } {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return toIso(daysFromCivil(year, month, day)) === value;
}

export function fromIso(iso: IsoDate): DayNumber {
  return daysFromCivil(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
}

export function toIso(dayNumber: DayNumber): IsoDate {
  const { year, month, day } = civilFromDays(dayNumber);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(dayNumber: DayNumber): number {
  return ((dayNumber % 7) + 11) % 7;
}

export function isWeekday(dayNumber: DayNumber): boolean {
  const dow = dayOfWeek(dayNumber);
  return dow >= 1 && dow <= 5;
}

/** Number of Monday-to-Friday days strictly before this day. */
export function weekdaysBefore(dayNumber: DayNumber): number {
  const offset = dayNumber - WEEKDAY_EPOCH;
  const weeks = Math.floor(offset / 7);
  const rest = offset - weeks * 7;
  return weeks * 5 + Math.min(rest, 5);
}

/** The day whose weekdaysBefore equals the given count, which is always a weekday. */
export function weekdayAt(count: number): DayNumber {
  const weeks = Math.floor(count / 5);
  const rest = count - weeks * 5;
  return WEEKDAY_EPOCH + weeks * 7 + rest;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mon 1 Mar 2027` */
export function longDate(iso: IsoDate): string {
  const dayNumber = fromIso(iso);
  const { year, month, day } = civilFromDays(dayNumber);
  return `${WEEKDAY_NAMES[dayOfWeek(dayNumber)]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** `Mon 1 Mar` */
export function shortDate(iso: IsoDate): string {
  const dayNumber = fromIso(iso);
  const { month, day } = civilFromDays(dayNumber);
  return `${WEEKDAY_NAMES[dayOfWeek(dayNumber)]} ${day} ${MONTH_NAMES[month - 1]}`;
}

export function mondayOf(iso: IsoDate): IsoDate {
  const dayNumber = fromIso(iso);
  const dow = dayOfWeek(dayNumber);
  const back = dow === 0 ? 6 : dow - 1;
  return toIso(dayNumber - back);
}

export function isMonday(iso: IsoDate): boolean {
  return dayOfWeek(fromIso(iso)) === 1;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIso(fromIso(iso) + days);
}
