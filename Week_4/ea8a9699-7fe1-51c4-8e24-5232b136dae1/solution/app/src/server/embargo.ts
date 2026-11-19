// Embargo resolution (brief: Business rules > Embargo time): a wall-clock liftLocal in the workspace's IANA
// zone becomes the instant liftsAt. A gap time is refused; a repeated time takes its earlier occurrence.

const LIFT_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const HOUR_MS = 3_600_000;

type Resolution = { ok: true; liftsAt: Date } | { ok: false; reason: "format" | "gap" };

function wallClock(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Offset of the zone at an instant, in milliseconds east of UTC. */
function offsetAt(instant: number, timeZone: string): number {
  const [date, time] = wallClock(instant, timeZone).split("T");
  const [y, m, d] = (date ?? "").split("-").map(Number);
  const [h, min] = (time ?? "").split(":").map(Number);
  const asUtc = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

export function resolveLiftLocal(liftLocal: string, timeZone: string): Resolution {
  const found = LIFT_LOCAL.exec(liftLocal);
  if (!found) return { ok: false, reason: "format" };
  const [year, month, day, hour, minute] = found.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(naive);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) {
    return { ok: false, reason: "format" };
  }
  const offsets = new Set([offsetAt(naive - 36 * HOUR_MS, timeZone), offsetAt(naive, timeZone), offsetAt(naive + 36 * HOUR_MS, timeZone)]);
  const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => wallClock(instant, timeZone) === liftLocal);
  if (!candidates.length) return { ok: false, reason: "gap" };
  return { ok: true, liftsAt: new Date(Math.min(...candidates)) };
}

/** The wall-clock form of an instant in a zone, as `YYYY-MM-DDTHH:MM`. */
export const toLiftLocal = (instant: Date, timeZone: string): string => wallClock(instant.getTime(), timeZone);
