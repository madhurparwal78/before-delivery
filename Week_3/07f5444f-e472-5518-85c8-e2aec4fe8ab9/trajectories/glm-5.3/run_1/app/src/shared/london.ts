// Europe/London wall-clock rules, shared by the server and the client.
// The single place that decides a London wall-clock time's instant and offset.

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const offsetFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  timeZoneName: "longOffset",
});

export interface LondonWall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The offset Europe/London carries at an instant, in minutes east of UTC. */
export function londonOffsetMinutes(instant: number): number {
  const name = offsetFormatter.format(instant);
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The London wall clock at an instant. */
export function instantToLondon(instant: number): LondonWall {
  const parts = partsFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : "";
  };
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

export type WallToInstant =
  | { kind: "ok"; instant: number; offsetMinutes: number }
  | { kind: "missing" };

/**
 * The instant of a London wall-clock time. A time that occurs twice in the
 * hour the clocks go back resolves to the earlier instant, which carries
 * summer time's offset. A time in the skipped hour does not exist.
 */
export function wallToInstant(wall: LondonWall): WallToInstant {
  const candidates: number[] = [];
  for (const offset of [0, 60]) {
    const instant =
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
      offset * 60000;
    if (londonOffsetMinutes(instant) === offset) candidates.push(instant);
  }
  if (candidates.length === 0) return { kind: "missing" };
  const instant = Math.min(...candidates);
  return { kind: "ok", instant, offsetMinutes: londonOffsetMinutes(instant) };
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/** An instant as ISO 8601 with the business zone's offset, e.g. 2026-12-01T10:00:00+00:00. */
export function formatTimestamp(instant: number): string {
  const wall = instantToLondon(instant);
  const offset = londonOffsetMinutes(instant);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` +
    `T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** A business-zone date, YYYY-MM-DD. */
export function londonDateString(instant: number): string {
  const wall = instantToLondon(instant);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** A business-zone date like Sat 14 Nov 2026. */
export function formatDate(instant: number): string {
  const parts = dateFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}

/** A date-only string (YYYY-MM-DD) in the business zone, like Sat 14 Nov 2026. */
export function formatDateString(date: string): string {
  const wall = parseDateString(date);
  if (!wall) return date;
  return formatDate(Date.UTC(wall.year, wall.month - 1, wall.day, 12));
}

export function parseDateString(date: string): LondonWall | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 12,
    minute: 0,
    second: 0,
  };
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

/** A business-zone date and time like Tue 1 Dec 2026, 10:00. */
export function formatDateTime(instant: number): string {
  const parts = dateTimeFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${hour}:${get("minute")}`;
}

/** A running time in whole seconds as M:SS. */
export function formatRunningTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${pad(rest)}`;
}
