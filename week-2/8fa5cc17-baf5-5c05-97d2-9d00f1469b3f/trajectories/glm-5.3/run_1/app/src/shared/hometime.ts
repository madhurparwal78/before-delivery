// Home-clock time and date formatting on the server, with a small IANA zone
// offset cache. The single home of "today on the home clock" and the
// published time formats.

const zoneCache = new Map<string, number>();
const ZONE_RE = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)*$/;

export function isZoneName(name: string): boolean {
  if (!ZONE_RE.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function offsetFor(zone: string, at: Date): number {
  // offset in minutes east of UTC for the zone at the given instant
  const key = `${zone}|${at.toISOString().slice(0, 13)}`;
  const cached = zoneCache.get(key);
  if (cached !== undefined) return cached;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "0";
  const asUTC = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), Number(get("hour")) % 24, Number(get("minute")), Number(get("second")));
  const offset = Math.round((asUTC - at.getTime()) / 60000);
  if (zoneCache.size > 2000) zoneCache.clear();
  zoneCache.set(key, offset);
  return offset;
}

export interface Zoned {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 Sunday
}

export function zonedParts(at: Date, zone: string): Zoned {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const wd = weekdayNames.indexOf(get("weekday")) % 7;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: wd === -1 ? 0 : wd,
  };
}

/** The calendar date at the given instant on the home clock. */
export function homeDate(at: Date, zone: string): string {
  const p = zonedParts(at, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `<Weekday> <D> <Month> <YYYY>`, e.g. `Thursday 29 October 2026`. */
export function dateHeading(date: string, zone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // weekday from the calendar date in the zone (dates are local)
  const utc = new Date(Date.UTC(y, m - 1, d));
  const parts = zonedParts(new Date(utc.getTime() + 12 * 3600000), zone);
  const wd = dayOfWeek(y, m, d);
  void parts;
  return `${WEEKDAYS[wd]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** Day of week for a calendar date (0 Sunday), timezone-independent. */
export function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** `<D> <Mon> <YYYY>, <HH:MM>` on the home clock. */
export function dateTimeShort(at: Date, zone: string): string {
  const p = zonedParts(at, zone);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** `<D> <Mon> <YYYY>, <HH:MM> <zone>`, e.g. `29 Oct 2026, 18:30 Europe/London`. */
export function expiresDisplay(at: Date, zone: string): string {
  const p = zonedParts(at, zone);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ${zone}`;
}

/** `<D> <Mon> <YYYY>, <HH:MM>` (no zone) for a zone-local timestamp string. */
export function dateTimeShortLocal(date: string, hhmm: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}, ${hhmm}`;
}

/**
 * Convert a whole home-clock minute to its UTC instant. Returns null when the
 * local time does not exist in a daylight-saving gap. In an overlap the first
 * occurrence is used.
 */
export function localMinuteToUtc(date: string, hhmm: string, zone: string, now: Date): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const localMs = Date.UTC(y, m - 1, d, hh, mm);
  // candidate offsets: probe offsets across the surrounding day
  const guesses = new Set<number>();
  for (const probeMs of [localMs - 12 * 3600000, localMs, localMs + 12 * 3600000]) {
    guesses.add(offsetFor(zone, new Date(probeMs)));
  }
  const cands: Array<{ utc: number; offset: number }> = [];
  for (const off of guesses) {
    const utc = localMs - off * 60000;
    if (offsetFor(zone, new Date(utc)) === off) {
      cands.push({ utc, offset: off });
    }
  }
  if (cands.length === 0) return null; // gap
  cands.sort((a, b) => b.offset - a.offset); // first occurrence = largest offset
  void now;
  return new Date(cands[0].utc);
}
