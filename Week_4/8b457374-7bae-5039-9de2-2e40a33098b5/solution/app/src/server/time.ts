// Wall-clock deadlines in IANA zones (brief: Deadline and length): a skipped local time has no instant,
// a repeated one takes the earlier of its two instants.

export const TIME_ZONES: string[] = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC"])].sort();
const ZONE_SET = new Set(TIME_ZONES);

export function isTimeZone(value: unknown): value is string {
  return typeof value === "string" && ZONE_SET.has(value);
}

interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` naming a real calendar date and clock time. */
export function parseLocal(value: unknown): LocalTime | null {
  const match = typeof value === "string" ? LOCAL.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number.parseInt(part ?? "0", 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

export function localText(t: LocalTime): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${t.year}-${two(t.month)}-${two(t.day)}T${two(t.hour)}:${two(t.minute)}:${two(t.second)}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: number, zone: string): number {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
  const n = (key: string) => Number.parseInt(parts[key], 10);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/** The UTC instant (ms) of a local time in `zone`, or null when the zone skips that time. */
export function zonedInstant(t: LocalTime, zone: string): number | null {
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const offsets = new Set([-86_400_000, 0, 86_400_000].map((shift) => wallClock(asUtc + shift, zone) - (asUtc + shift)));
  const instants = [...offsets].map((offset) => asUtc - offset).filter((instant) => wallClock(instant, zone) === asUtc);
  return instants.length ? Math.min(...instants) : null;
}

export function iso(instant: number): string {
  return new Date(instant).toISOString();
}
