/** The sales-office time format, shared by the server (API copy) and the browser (every end time). */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

interface ZoneParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (zone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
};

const partsIn = (zone: string, epochMs: number): ZoneParts => {
  const found: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found["year"] ?? 1970,
    month: found["month"] ?? 1,
    day: found["day"] ?? 1,
    hour: (found["hour"] ?? 0) % 24,
    minute: found["minute"] ?? 0,
    second: found["second"] ?? 0,
  };
};

const offsetMinutes = (zone: string, epochMs: number): number => {
  const parts = partsIn(zone, epochMs);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
};

const abbreviation = (minutes: number): string => {
  if (minutes === 660) return "AEDT";
  if (minutes === 600) return "AEST";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
};

/** `Mon 5 Apr 15:00 AEST`: seconds dropped, never rounded. */
export const formatOfficeTime = (instant: Date | string | number, zone: string): string => {
  const epochMs = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  const parts = partsIn(zone, epochMs);
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${weekday} ${parts.day} ${MONTHS[parts.month - 1]} ${pad(parts.hour)}:${pad(parts.minute)} ${abbreviation(offsetMinutes(zone, epochMs))}`;
};

export const DEFAULT_OFFICE_ZONE = "Australia/Sydney";
