import { addDays, type IsoDate } from "../shared/dates";
import { digitsToInteger } from "../shared/digits";

const BUSINESS_DAY_HOUR = 4;
export const FREE_CANCELLATION_HOUR = 18;

/** The hotel's clock: a held instant when the grading route set one, else real time. */
export function hotelNow(heldInstant: Date | null): Date {
  return heldInstant ?? new Date();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

export function isTimeZone(value: string): boolean {
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

interface LocalParts { date: IsoDate; hour: number; utcMs: number }

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const [year, month, day, hour, minute, second] = ["year", "month", "day", "hour", "minute", "second"].map((key) =>
    digitsToInteger(parts[key] ?? "0"),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: hour ?? 0,
    utcMs: Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0),
  };
}

/** The night a moment belongs to: local date from 04:00, the previous date before it. */
export function nightOf(instant: Date, timeZone: string): IsoDate {
  const { date, hour } = localParts(instant, timeZone);
  return hour >= BUSINESS_DAY_HOUR ? date : addDays(date, -1);
}

/** The instant at which the hotel's wall clock reads `hour:00:00` on `date`. */
export function instantAt(date: IsoDate, hour: number, timeZone: string): Date {
  const wanted = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  let instant = wanted - (localParts(new Date(wanted), timeZone).utcMs - wanted);
  const offset = localParts(new Date(instant), timeZone).utcMs - instant;
  instant = wanted - offset;
  return new Date(instant);
}
