// Every date shown to a person is written here: "<D> <Month> <YYYY>, <HH:MM>" in the operator's time zone.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number.parseInt(part.value, 10);
  }
  return {
    year: parts.year ?? 0, month: parts.month ?? 1, day: parts.day ?? 1,
    hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0,
  };
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** "9 November 2026, 14:05" for the instant in the given IANA zone. */
export function formatBusinessDate(instant: Date | string, timeZone: string): string {
  const p = zonedParts(typeof instant === "string" ? new Date(instant) : instant, timeZone);
  return `${p.day} ${MONTH_NAMES[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2027-03" → "March 2027". */
export function monthLabel(month: string): string {
  const [year = "", number = "1"] = month.split("-");
  return `${MONTH_NAMES[Number.parseInt(number, 10) - 1]} ${year}`;
}

/** The calendar month ("YYYY-MM") the instant falls in, in the given zone. */
export function monthKeyAt(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}`;
}

/** The month key `count` months after `month` ("2026-11", 2 → "2027-01"). */
export function addMonths(month: string, count: number): string {
  const [year = "0", number = "1"] = month.split("-");
  const index = Number.parseInt(year, 10) * 12 + Number.parseInt(number, 10) - 1 + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "YYYY-MM-DDTHH:MM" wall time in the zone, for datetime-local inputs. */
export function wallTimeAt(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The instant whose wall time in the zone is "YYYY-MM-DDTHH:MM"; null when unparseable. */
export function instantFromWallTime(wall: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map((value) => Number.parseInt(value, 10));
  const target = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  let guess = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - seen;
  }
  return new Date(guess);
}

/** The business date, decided here only: the operator's local calendar date ("YYYY-MM-DD") at the instant. */
export function businessDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2026-11-09" → "9 November 2026". */
export function formatCalendarDate(date: string): string {
  const [year = "", month = "1", day = "1"] = date.split("-");
  return `${Number.parseInt(day, 10)} ${MONTH_NAMES[Number.parseInt(month, 10) - 1]} ${year}`;
}
