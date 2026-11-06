/** America/Toronto business time, independent of the server's own time zone. */
const ZONE = "America/Toronto";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "longOffset",
});

type Parts = { date: string; time: string; seconds: string; offset: string };

function parts(instant: Date): Parts {
  const map: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(instant)) map[part.type] = part.value;
  const offset = (map.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, seconds: map.second ?? "00", offset };
}

/** `2026-11-03T19:00:00-05:00`: whole seconds with the Toronto offset. */
export function isoToronto(instant: Date): string {
  const p = parts(instant);
  return `${p.date}T${p.time}:${p.seconds}${p.offset}`;
}

/** Mail outbox times carry milliseconds (brief: API). */
export function isoTorontoMs(instant: Date): string {
  const p = parts(instant);
  return `${p.date}T${p.time}:${p.seconds}.${String(instant.getUTCMilliseconds()).padStart(3, "0")}${p.offset}`;
}

/** `<date>` in Toronto. */
export function torontoDate(instant: Date): string {
  return parts(instant).date;
}

/** `<time>` (HH:MM) in Toronto. */
export function torontoTime(instant: Date): string {
  return parts(instant).time;
}

/** `YYYY-MM-DDTHH:MM` Toronto wall clock. */
export function torontoLocal(instant: Date): string {
  const p = parts(instant);
  return `${p.date}T${p.time}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

/**
 * The instant of a Toronto wall-clock time. A time in the spring-forward gap moves forward one
 * hour; a time in the fall-back hour takes the first (daylight-time) occurrence.
 */
export function torontoInstant(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const matches = [-4, -5]
    .map((offsetHours) => new Date(wall - offsetHours * 3600_000))
    .filter((instant) => torontoLocal(instant) === `${date}T${time}`);
  const first = matches[0];
  if (first) return first;
  const shifted = new Date(wall + 3600_000).toISOString();
  return torontoInstant(shifted.slice(0, 10), shifted.slice(11, 16));
}

/** The Toronto business day: local midnight to the next local midnight (23, 24 or 25 hours). */
export function businessDay(date: string): { start: Date; end: Date } {
  return { start: torontoInstant(date, "00:00"), end: torontoInstant(addDays(date, 1), "00:00") };
}
