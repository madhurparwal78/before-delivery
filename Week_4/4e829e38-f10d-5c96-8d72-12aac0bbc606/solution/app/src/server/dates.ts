/** ISO calendar-date arithmetic on `YYYY-MM-DD` strings (proleptic Gregorian, no time zones). */

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type Weekday = (typeof WEEKDAYS)[number];

/** Days since 1970-01-01 of a civil date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return daysFromCivil(year, month, day);
}

function fromDayNumber(days: number): string {
  const [year, month, day] = civilFromDays(days);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromDayNumber(dayNumber(value)) === value;
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[(((dayNumber(iso) + 4) % 7) + 7) % 7];
}

export function isWorkingDay(iso: string): boolean {
  const day = weekdayOf(iso);
  return day !== "sat" && day !== "sun";
}

export function mondayOf(iso: string): string {
  return addDays(iso, -((WEEKDAYS.indexOf(weekdayOf(iso)) + 6) % 7));
}

export function daysInMonth(year: number, month: number): number {
  return daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - daysFromCivil(year, month, 1);
}
