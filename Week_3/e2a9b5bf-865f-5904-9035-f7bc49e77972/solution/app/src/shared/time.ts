const ISO_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/** Parses the published input format (`...Z`, optional 1-3 digit fraction); null otherwise. */
export function parseUtc(text: unknown): Date | null {
  if (typeof text !== "string") return null;
  const m = ISO_INPUT.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac] = m;
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms));
  const same =
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d) &&
    date.getUTCHours() === Number(h) &&
    date.getUTCMinutes() === Number(mi) &&
    date.getUTCSeconds() === Number(s);
  return same ? date : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYY-MM-DDTHH:MM:SSZ`, dropping any fraction. */
export function isoSeconds(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

/** `YYYY-MM-DD HH:MM` as typed in the UT field. */
export function utText(date: Date): string {
  return `${isoSeconds(date).slice(0, 10)} ${isoSeconds(date).slice(11, 16)}`;
}

/** Parses the UT field's `YYYY-MM-DD HH:MM` to a Date, or null. */
export function parseUtText(text: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(text.trim());
  return m ? parseUtc(`${m[1]}T${m[2]}:00Z`) : null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date, zone: string): LocalParts {
  const values: Record<string, number> = {};
  for (const part of zoneFormatter(zone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** The zone's UTC offset in minutes at that exact instant. */
function offsetMinutes(date: Date, zone: string): number {
  const p = localParts(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function localClock(date: Date, zone: string): string {
  const p = localParts(date, zone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function offsetAt(date: Date, zone: string): string {
  return formatOffset(offsetMinutes(date, zone));
}

/** The site-zone date of the start, or the day before when the local start is before 12:00. */
export function eveningDate(startedAt: Date, zone: string): string {
  const p = localParts(startedAt, zone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (p.hour < 12) day.setUTCDate(day.getUTCDate() - 1);
  return isoSeconds(day).slice(0, 10);
}

const SESSION_WINDOW_MS = 18 * 3600 * 1000;

/** True when `observed` is at or after `started` and under 18 elapsed hours after it. */
export function withinSession(started: Date, observed: Date): boolean {
  const delta = observed.getTime() - started.getTime();
  return delta >= 0 && delta < SESSION_WINDOW_MS;
}

export const TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Budapest",
  "Africa/Johannesburg",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;
