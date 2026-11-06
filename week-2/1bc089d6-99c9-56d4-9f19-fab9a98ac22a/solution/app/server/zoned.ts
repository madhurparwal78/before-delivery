/** Wall-clock arithmetic in IANA time zones with nothing but Intl. Dates are `YYYY-MM-DD`, times `HH:MM`. */

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

interface Wall {
  date: string;
  time: string;
  /** The same wall time as if it were UTC, in epoch milliseconds (minute precision). */
  asUtc: number;
}

export function wallAt(instant: number, timeZone: string): Wall {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return { date, time, asUtc: Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) };
}

const offsetAt = (instant: number, timeZone: string) => wallAt(instant, timeZone).asUtc - Math.floor(instant / MINUTE) * MINUTE;

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The instant a local wall time happens. When the clocks fall back and the time happens twice, the first
 * occurrence; when they spring forward and it never happens, the first minute that exists after it.
 */
export function instantOf(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  const before = offsetAt(wall - 12 * 3_600_000, timeZone);
  const after = offsetAt(wall + 12 * 3_600_000, timeZone);
  const matches = [wall - before, wall - after].filter((candidate) => wallAt(candidate, timeZone).asUtc === wall);
  if (matches.length) return Math.min(...matches);
  let low = wall - Math.max(before, after);
  let high = wall - Math.min(before, after);
  while (high - low > MINUTE) {
    const middle = Math.floor((low + high) / 2 / MINUTE) * MINUTE;
    if (offsetAt(middle, timeZone) === before) low = middle;
    else high = middle;
  }
  return high;
}
