// Club time: reading club-local wall-clock text as instants and printing instants for people.
// Instants are whole Unix seconds; every duration is elapsed time between instants.

let zone = "America/Chicago";

export function useClubZone(timeZone: string): void {
  zone = timeZone;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = partsFormat.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      timeZoneName: "short",
    });
    partsFormat.set(timeZone, format);
  }
  return format;
}

function parts(instant: number): Wall & { weekday: string; zoneName: string } {
  const found: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant * 1000))) found[part.type] = part.value;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
    weekday: found.weekday ?? "",
    zoneName: found.timeZoneName ?? "",
  };
}

function wallSeconds(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) / 1000;
}

/** Club offset from UTC, in seconds, at an instant. */
function offsetAt(instant: number): number {
  return wallSeconds(parts(instant)) - instant;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

type LocalReading = { instant: number } | { problem: "format" | "gap" };

/**
 * Reads `YYYY-MM-DDTHH:MM[:SS]` as club wall-clock time. A time in a daylight-saving gap is a
 * problem; a repeated time takes its earlier instant.
 */
export function readLocal(text: unknown): LocalReading {
  const match = typeof text === "string" ? LOCAL.exec(text) : null;
  if (!match) return { problem: "format" };
  const [year, month, day, hour, minute, second] = match.slice(1).map((n) => Number(n ?? 0)) as number[];
  const wall: Wall = { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: second! };
  const asUtc = wallSeconds(wall);
  const check = new Date(asUtc * 1000);
  if (
    check.getUTCFullYear() !== wall.year || check.getUTCMonth() + 1 !== wall.month ||
    check.getUTCDate() !== wall.day || wall.hour > 23 || wall.minute > 59 || wall.second > 59
  ) {
    return { problem: "format" };
  }
  const offsets = new Set([offsetAt(asUtc - 86_400), offsetAt(asUtc), offsetAt(asUtc + 86_400)]);
  const matches = [...offsets].map((offset) => asUtc - offset).filter((instant) => offsetAt(instant) === asUtc - instant);
  if (matches.length === 0) return { problem: "gap" };
  return { instant: Math.min(...matches) };
}

/** The instant of a club-local wall-clock reading that exists, e.g. the seed's cutoff. */
export function localInstant(w: Wall): number {
  const reading = readLocal(
    `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`,
  );
  if ("problem" in reading) throw new Error("seed time does not exist in club time");
  return reading.instant;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(p: Wall): string {
  const seconds = p.second ? `:${pad(p.second)}` : "";
  return `${p.hour % 12 || 12}:${pad(p.minute)}${seconds} ${p.hour < 12 ? "am" : "pm"}`;
}

function dayText(p: Wall & { weekday: string }): string {
  return `${p.weekday} ${p.day} ${MONTHS[p.month - 1]}`;
}

/** `Thu 5 Nov, 8:00 pm CST` */
export function cutoffDisplay(instant: number): string {
  const p = parts(instant);
  return `${dayText(p)}, ${clock(p)} ${p.zoneName}`;
}

/** `Sat 6 Nov, 8:00 pm CDT to Sun 7 Nov, 7:00 am CST` */
export function pickupDisplay(start: number, end: number): string {
  const s = parts(start);
  const e = parts(end);
  const head = `${dayText(s)}, ${clock(s)}${s.zoneName !== e.zoneName ? ` ${s.zoneName}` : ""}`;
  const sameDate = s.year === e.year && s.month === e.month && s.day === e.day;
  return `${head} to ${sameDate ? "" : `${dayText(e)}, `}${clock(e)} ${e.zoneName}`;
}

/** The club-local calendar date of an instant, `YYYY-MM-DD`. */
export function clubDate(instant: number): string {
  const p = parts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The club-local wall clock of an instant, for building seed times. */
export function clubWall(instant: number): Wall {
  return parts(instant);
}

export function isoInstant(instant: number): string {
  return new Date(instant * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const HOUR = 3600;
