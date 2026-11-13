import { WEEKDAYS, type Weekday } from "../../shared/api.js";

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(zone, found);
  }
  return found;
}

export function canonicalZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

interface LocalTime {
  date: string;
  hour: number;
  minute: number;
  weekday: Weekday;
  wallMs: number;
}

function localTime(instantMs: number, zone: string): LocalTime {
  const parts: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instantMs))) parts[part.type] = part.value;
  const [year, month, day] = [Number(parts.year), Number(parts.month), Number(parts.day)];
  const [hour, minute, second] = [Number(parts.hour), Number(parts.minute), Number(parts.second)];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    weekday: parts.weekday as Weekday,
    wallMs: Date.UTC(year, month - 1, day, hour, minute, second),
  };
}

function offsetMs(instantMs: number, zone: string): number {
  return localTime(instantMs, zone).wallMs - Math.floor(instantMs / 1000) * 1000;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;
}

/** The first instant the zone's wall clock reads `hour:00` on `date`, or the first instant after a gap. */
function dayStartInstant(zone: string, date: string, hour: number): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + hour * 3_600_000;
  const offsets = [offsetMs(wall - DAY_MS, zone), offsetMs(wall + DAY_MS, zone)];
  const readings = offsets.map((offset) => wall - offset).filter((candidate, index) => offsetMs(candidate, zone) === offsets[index]);
  return readings.length > 0 ? Math.min(...readings) : wall - offsets[0]!;
}

/** The open local date of a player at `instantMs`: the date whose day contains it. */
export function dateContaining(instantMs: number, zone: string, hour: number): string {
  const local = localTime(instantMs, zone).date;
  return instantMs >= dayStartInstant(zone, local, hour) ? local : addDays(local, -1);
}

/** The instant the close of `date` runs: the day start of the next date. */
export function closeInstant(zone: string, date: string, hour: number): Date {
  return new Date(dayStartInstant(zone, addDays(date, 1), hour));
}

export function dayStartText(instant: Date, zone: string): string {
  const local = localTime(instant.getTime(), zone);
  const clock = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return `${local.weekday} ${clock} (${zone})`;
}
