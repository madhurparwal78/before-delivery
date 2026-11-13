// Cutoffs, offsets and labels in a program's IANA time zone (brief: Business rules, Time and labels).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const formatters = new Map<string, Intl.DateTimeFormat>();

interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

function localTime(instant: Date, zone: string): LocalTime {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0,
    hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(instant: Date, zone: string): number {
  const local = localTime(instant, zone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** An IANA zone name the runtime knows, such as Asia/Kolkata; offsets like +05:30 are not zone names. */
export function isTimeZone(name: unknown): name is string {
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    formatter(name);
    return true;
  } catch {
    return false;
  }
}

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** The exclusive boundary of date D: 00:00:00 local time on the day after D. */
export function cutoff(date: string, zone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day + 1);
  let instant = wall - offsetMinutes(new Date(wall), zone) * 60000;
  instant = wall - offsetMinutes(new Date(instant), zone) * 60000;
  return new Date(instant);
}

/** ISO 8601 with the zone's offset at that instant, e.g. 2027-01-01T00:00:00+05:30. */
export function isoInZone(instant: Date, zone: string): string {
  const offset = offsetMinutes(instant, zone);
  const local = localTime(instant, zone);
  const two = (n: number) => String(n).padStart(2, "0");
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const millis = instant.getTime() % 1000;
  const fraction = millis ? `.${String(millis).padStart(3, "0")}` : "";
  return `${local.year}-${two(local.month)}-${two(local.day)}T${two(local.hour)}:${two(local.minute)}:${two(local.second)}`
    + `${fraction}${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** "23:59 Asia/Kolkata, 31 Dec 2026" for a deadline date D. */
export function deadlineLabel(date: string, zone: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `23:59 ${zone}, ${day} ${MONTHS[month - 1]} ${year}`;
}

/** "<HH>:<MM> <zone>, <D> <Mon> <YYYY>" for an instant, written in the zone. */
export function instantLabel(instant: Date, zone: string): string {
  const local = localTime(instant, zone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(local.hour)}:${two(local.minute)} ${zone}, ${local.day} ${MONTHS[local.month - 1]} ${local.year}`;
}

/** The calendar date in the zone at that instant, plus a number of days. */
export function zoneDate(instant: Date, zone: string, addDays = 0): string {
  const local = localTime(instant, zone);
  return new Date(Date.UTC(local.year, local.month - 1, local.day + addDays)).toISOString().slice(0, 10);
}

/** ISO 8601 with an explicit offset or Z; anything else is not an embargo time. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
