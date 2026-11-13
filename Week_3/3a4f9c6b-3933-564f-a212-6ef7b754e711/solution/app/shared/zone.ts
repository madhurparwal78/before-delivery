// Wall-clock time in an IANA zone, including the clock-change rule for sync windows.
// Used by the server (window check, openings, message bodies) and by the browser (cluster time format,
// the Check an instant form). The browser's and the server's own zones never play a part.

interface LocalParts {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  weekday: number; // 0 = mon … 6 = sun
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

export function localParts(instant: number, zone: string): LocalParts {
  const fields: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) fields[part.type] = part.value;
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
    millisecond: ((instant % 1000) + 1000) % 1000,
    weekday: WEEKDAYS.indexOf(fields.weekday ?? ""),
  };
}

function offsetMs(instant: number, zone: string): number {
  const local = localParts(instant, zone);
  const [y, m, d] = local.date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, local.hour, local.minute, local.second, local.millisecond) - instant;
}

/**
 * The instant at which `date` `time` (HH:MM, `24:00` meaning the next midnight) occurs in `zone`.
 * A local time skipped by clocks going forward moves forward by the length of the gap; a local time
 * that occurs twice because clocks went back takes the earlier occurrence.
 */
export function localToInstant(date: string, time: string, zone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMs(naive - 86_400_000, zone);
  const after = offsetMs(naive + 86_400_000, zone);
  const valid = [...new Set([before, after])]
    .map((offset) => naive - offset)
    .filter((instant) => offsetMs(instant, zone) === naive - instant);
  return valid.length ? Math.min(...valid) : naive - before;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD HH:mm` in the zone. */
export function localMinute(instant: number, zone: string): string {
  const local = localParts(instant, zone);
  return `${local.date} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
}

/** Cluster time format: `YYYY-MM-DD HH:mm <IANA zone>`. Freeze instants use the zone `UTC`. */
export function clusterTime(instant: number | string, zone: string): string {
  return `${localMinute(typeof instant === "string" ? Date.parse(instant) : instant, zone)} ${zone}`;
}
