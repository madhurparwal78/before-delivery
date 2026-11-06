// Zoned calendar arithmetic and the brief's "<when>" format ("27 Oct 2026, 14:05").

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

/** The calendar date (y, m, d) an instant falls on in a zone. */
export function zonedDate(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

/** 00:00 on a calendar date in a zone, as a UTC instant. `addDays` moves the calendar date first. */
export function zonedMidnight(date: { year: number; month: number; day: number }, timeZone: string, addDays = 0): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day + addDays);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wall - shown;
  }
  return new Date(guess);
}

/** "27 Oct 2026, 14:05" in the given zone. */
export function formatWhen(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** UTC ISO 8601 with seconds and a trailing Z. */
export function isoSeconds(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}
