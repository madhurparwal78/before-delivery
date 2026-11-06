/** Time zone arithmetic with Intl only; a club's events are always read in its own zone. */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsIn(timeZone: string, instant: Date): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values["year"] ?? 0,
    month: values["month"] ?? 0,
    day: values["day"] ?? 0,
    hour: values["hour"] ?? 0,
    minute: values["minute"] ?? 0,
  };
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** `YYYY-MM-DD` of an instant in a zone. */
export function localDate(instant: Date, timeZone: string): string {
  const p = partsIn(timeZone, instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `HH:MM` on a 24-hour clock of an instant in a zone. */
export function localClock(instant: Date, timeZone: string): string {
  const p = partsIn(timeZone, instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DD HH:MM` of an instant in a zone. */
export function localStamp(instant: Date, timeZone: string): string {
  return `${localDate(instant, timeZone)} ${localClock(instant, timeZone)}`;
}

/** The instant a zone's wall clock reads `YYYY-MM-DDTHH:MM`. */
export function zonedToInstant(local: string, timeZone: string): Date {
  const [datePart = "", timePart = ""] = local.split("T");
  const [year = 0, month = 0, day = 0] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0] = timePart.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (guess: number): number => {
    const p = partsIn(timeZone, new Date(guess));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  };
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
