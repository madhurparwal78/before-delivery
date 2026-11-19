import { formatInZone, type LocalTimeParts } from "../shared/rules";

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The zone's wall-clock reading at an instant, expressed as if that reading were UTC. */
function wallClockMs(zone: string, instantMs: number): number {
  const read: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(instantMs)) read[part.type] = Number(part.value);
  return Date.UTC(read.year ?? 0, (read.month ?? 1) - 1, read.day ?? 1, read.hour ?? 0, read.minute ?? 0, read.second ?? 0);
}

/** `YYYY-MM-DDTHH:mm` in the zone: the wire form of a classroom's local time. */
export function instantToLocalWire(instant: Date, zone: string): string {
  return formatInZone(instant, zone).replace(" ", "T");
}

interface ResolvedLocalTime {
  instant: Date;
  /** The wall-clock time does not exist in the zone; `instant` is then the same reading on the pre-gap offset. */
  inGap: boolean;
}

/** Local wall-clock time in an IANA zone to an instant. An ambiguous fall-back hour means its first occurrence. */
export function resolveLocalTime(parts: LocalTimeParts, zone: string): ResolvedLocalTime {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsetBefore = wallClockMs(zone, wall - DAY_MS) - (wall - DAY_MS);
  const offsetAfter = wallClockMs(zone, wall + DAY_MS) - (wall + DAY_MS);
  const candidates = [...new Set([wall - offsetBefore, wall - offsetAfter])];
  const real = candidates.filter((candidate) => wallClockMs(zone, candidate) === wall);
  if (real.length === 0) return { instant: new Date(wall - offsetBefore), inGap: true };
  return { instant: new Date(Math.min(...real)), inGap: false };
}

/** The same wall-clock reading some calendar days later, in the zone. */
export function addLocalDays(parts: LocalTimeParts, days: number): LocalTimeParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { ...parts, year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}
