// Calendar and timezone arithmetic. Opening hours are wall-clock times in a shop's own IANA
// timezone; this is the one place that turns a local date and time into an instant.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(zone, found);
  }
  return found;
}

/** Minutes east of UTC that `zone` is on at the instant `utcMs`. */
function offsetMinutes(zone: string, utcMs: number): number {
  const seconds = Math.floor(utcMs / 1000) * 1000;
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(seconds)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  return Math.round((wall - seconds) / 60000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function isoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
}

/** Monday is 1 and Sunday is 7. */
export function weekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

interface LocalMoment {
  date: string;
  minutes: number;
}

export function localMoment(zone: string, utcMs: number): LocalMoment {
  const wall = utcMs + offsetMinutes(zone, utcMs) * 60000;
  const stamp = new Date(wall);
  return { date: stamp.toISOString().slice(0, 10), minutes: stamp.getUTCHours() * 60 + stamp.getUTCMinutes() };
}

export function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

interface LocalInstant {
  utcMs: number;
  offset: number;
}

/**
 * The instant a wall-clock time falls on. A time that does not exist that day (the clocks went
 * forward over it) gives null; a time that happens twice gives the earlier, summer-offset one.
 */
export function localInstant(zone: string, date: string, minutes: number): LocalInstant | null {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60000;
  const candidates = new Set([offsetMinutes(zone, wall - 86_400_000), offsetMinutes(zone, wall + 86_400_000)]);
  const valid: LocalInstant[] = [];
  for (const offset of candidates) {
    const utcMs = wall - offset * 60000;
    if (offsetMinutes(zone, utcMs) === offset) valid.push({ utcMs, offset });
  }
  valid.sort((a, b) => a.utcMs - b.utcMs);
  return valid[0] ?? null;
}

/** The first instant at or after a wall-clock time that exists; used for a day's opening instant. */
export function firstLocalInstant(zone: string, date: string, minutes: number): LocalInstant {
  for (let at = minutes; at < minutes + 120; at += 1) {
    const found = localInstant(zone, date, at);
    if (found) return found;
  }
  throw new Error(`no local instant for ${date} ${minutes} in ${zone}`);
}

export function isoInstant(utcMs: number): string {
  return new Date(utcMs).toISOString();
}
