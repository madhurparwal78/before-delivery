const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const LISBON = "Europe/Lisbon";

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(zone, format);
  }
  return format;
}

function wallClock(instant: Date, zone: string): WallClock {
  const parts = Object.fromEntries(formatFor(zone).formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (value: number): string => String(value).padStart(2, "0");

function dateOf(clock: WallClock): string {
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/** The instant as a whole-second UTC string with a Z. */
export function instantText(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

/** 24-hour HH:MM wall time in the zone. */
export function wallTime(instant: string | Date, zone: string = LISBON): string {
  const clock = wallClock(new Date(instant), zone);
  return `${pad(clock.hour)}:${pad(clock.minute)}`;
}

/** The YYYY-MM-DD local date in the zone. */
export function localDate(instant: string | Date, zone: string = LISBON): string {
  return dateOf(wallClock(new Date(instant), zone));
}

/** A YYYY-MM-DD date in the form Mon 29 Mar 2027. */
export function shownDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${DAY_NAMES[weekday]} ${pad(day)} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** The instant's date in the form Mon 29 Mar 2027 on the zone's local date. */
export function shownDate(instant: string | Date, zone: string = LISBON): string {
  return shownDay(localDate(instant, zone));
}

function asUtcMillis(date: string, time: string): number {
  return Date.parse(`${date}T${time}Z`);
}

/**
 * The instant of a wall-clock time in a zone: null when a clock change skips it, the first when it
 * happens twice.
 */
export function wallToInstant(date: string, time: string, zone: string): Date | null {
  const wanted = asUtcMillis(date, time.length === 5 ? `${time}:00` : time);
  const offsets = new Set<number>();
  for (const probe of [wanted - 86_400_000, wanted + 86_400_000]) {
    const clock = wallClock(new Date(probe), zone);
    offsets.add(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - probe);
  }
  const matches = [...offsets]
    .map((offset) => wanted - offset)
    .filter((candidate) => {
      const clock = wallClock(new Date(candidate), zone);
      return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) === wanted;
    })
    .sort((a, b) => a - b);
  return matches.length ? new Date(matches[0] as number) : null;
}

function nextDate(date: string, days = 1): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** How many hours the local day has in the zone: 23 and 25 around clock changes. */
export function hoursOfDay(date: string, zone: string = LISBON): number {
  const start = wallToInstant(date, "00:00:00", zone) as Date;
  const end = wallToInstant(nextDate(date), "00:00:00", zone) as Date;
  return Math.round((end.getTime() - start.getTime()) / 3_600_000);
}

/** The first day from this date on, in the zone, that does not have 24 hours. */
export function nextClockChange(fromDate: string, zone: string = LISBON): string {
  for (let date = nextDate(fromDate); ; date = nextDate(date)) {
    if (hoursOfDay(date, zone) !== 24) return date;
  }
}

export function addDays(date: string, days: number): string {
  return nextDate(date, days);
}

export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function isRealTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}
