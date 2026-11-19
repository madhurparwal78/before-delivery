// Venue time (America/Chicago): the start label, the offer expiry wording and publishing a wall time.

const VENUE_ZONE = "America/Chicago";

const labelParts = new Intl.DateTimeFormat("en-US", {
  timeZone: VENUE_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

const wallParts = new Intl.DateTimeFormat("en-US", {
  timeZone: VENUE_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function parts(format: Intl.DateTimeFormat, at: Date): Record<string, string> {
  return Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
}

/** `Fri 12 Feb 2027, 8:00 PM CST` */
export function venueLabel(at: Date): string {
  const p = parts(labelParts, at);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/** `8:15:03 PM CST on Fri 12 Feb 2027` */
export function venueExpiry(at: Date): string {
  const p = parts(labelParts, at);
  return `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod} ${p.timeZoneName} on ${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** The venue wall time of an instant, as if it were UTC, in milliseconds. */
function wallClock(at: number): number {
  const p = parts(wallParts, new Date(at));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_START = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The instant a venue wall time `YYYY-MM-DDTHH:MM` names: the first occurrence when the wall time repeats
 * (clocks fall back), `nonexistent` when it is skipped (clocks spring forward), `malformed` otherwise.
 */
export function resolveVenueStart(local: string): Date | "malformed" | "nonexistent" {
  const match = LOCAL_START.exec(local);
  if (!match) return "malformed";
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(naive);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || hour > 23 || minute > 59) return "malformed";
  const offsets = new Set([naive - DAY_MS, naive + DAY_MS].map((probe) => wallClock(probe) - probe));
  const instants = [...offsets].map((offset) => naive - offset).filter((instant) => wallClock(instant) === naive);
  if (instants.length === 0) return "nonexistent";
  return new Date(Math.min(...instants));
}
