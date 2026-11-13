// Port time: every conversion between instants and America/Halifax wall-clock readings.
// Durations are always differences of instants (milliseconds since the epoch), never of readings.

export const PORT_ZONE = "America/Halifax";
export const STEP_MINUTES = 5;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
const DAY_MINUTES = 24 * 60;

const reader = new Intl.DateTimeFormat("en-CA", {
  timeZone: PORT_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Reading {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function read(instant: number): Reading {
  const values: Record<string, number> = {};
  for (const part of reader.formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

const offsetCache = new Map<number, number>();

/** The port's UTC offset in minutes at an instant (Halifax changes only on the hour). */
function offsetMinutesAt(instant: number): number {
  const hour = Math.floor(instant / HOUR_MS);
  const cached = offsetCache.get(hour);
  if (cached !== undefined) return cached;
  const probe = hour * HOUR_MS;
  const r = read(probe);
  const asUtc = Date.UTC(r.year, r.month - 1, r.day, r.hour, r.minute, r.second);
  const offset = Math.round((asUtc - probe) / MINUTE_MS);
  offsetCache.set(hour, offset);
  return offset;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function readingAt(instant: number): Reading {
  const local = new Date(instant + offsetMinutesAt(instant) * MINUTE_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

/** `YYYY-MM-DD` of the port-local date at an instant. */
export function portDate(instant: number): string {
  const r = readingAt(instant);
  return `${pad(r.year, 4)}-${pad(r.month)}-${pad(r.day)}`;
}

/** `YYYY-MM-DDTHH:MM:SS` port time, the API's stamp and arrival format. */
export function portStamp(instant: number): string {
  const r = readingAt(instant);
  return `${portDate(instant)}T${pad(r.hour)}:${pad(r.minute)}:${pad(r.second)}`;
}

/** `YYYY-MM-DDTHH:MM` port time, the API's boarding and effective format. */
export function portMinute(instant: number): string {
  return portStamp(instant).slice(0, 16);
}

/** Minutes after port midnight, wall-clock, at an instant. */
export function portMinuteOfDay(instant: number): number {
  const r = readingAt(instant);
  return r.hour * 60 + r.minute;
}

/** `-03:00` or `-04:00`. */
export function utcOffsetText(instant: number): string {
  const offset = offsetMinutesAt(instant);
  const size = Math.abs(offset);
  return `${offset < 0 ? "-" : "+"}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/** `ADT` for `-03:00`, `AST` for `-04:00`. */
export function zoneAbbreviation(offsetText: string): string {
  return offsetText === "-03:00" ? "ADT" : "AST";
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isPortDate(text: string): boolean {
  const m = DATE_PATTERN.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** `HH:MM` to minutes after midnight, or null when malformed. */
export function minuteOfDay(text: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function clockText(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * The instant a port-local reading names. A repeated reading on a fall-back date means its first
 * occurrence; a reading inside the hour skipped on a spring-forward date names no instant (null).
 */
export function instantOfLocal(date: string, minutes: number): number | null {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const offsets = new Set([offsetMinutesAt(wall - 12 * HOUR_MS), offsetMinutesAt(wall + 12 * HOUR_MS)]);
  const matches = [...offsets]
    .map((offset) => wall - offset * MINUTE_MS)
    .filter((instant) => offsetMinutesAt(instant) * MINUTE_MS === wall - instant)
    .sort((a, b) => a - b);
  return matches[0] ?? null;
}

/** The published refusal for a time inside the hour skipped on a spring-forward date. */
export const SKIPPED_TIME = "That time does not exist in port time on this date";

type LocalMinuteCheck =
  | { kind: "ok"; instant: number; date: string; minutes: number }
  | { kind: "malformed" }
  | { kind: "skipped" };

/** Reads `YYYY-MM-DDTHH:MM` as port time. */
export function readPortMinute(text: string): LocalMinuteCheck {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text);
  if (!m || !isPortDate(m[1] ?? "")) return { kind: "malformed" };
  const date = m[1] ?? "";
  const minutes = minuteOfDay(m[2] ?? "");
  if (minutes === null) return { kind: "malformed" };
  const instant = instantOfLocal(date, minutes);
  return instant === null ? { kind: "skipped" } : { kind: "ok", instant, date, minutes };
}

interface Step {
  minutes: number;
  instant: number;
}

/** The 5-minute boarding steps that exist on a port-local date, in order. */
export function stepsOfDate(date: string): Step[] {
  const steps: Step[] = [];
  for (let minutes = 0; minutes < DAY_MINUTES; minutes += STEP_MINUTES) {
    const instant = instantOfLocal(date, minutes);
    if (instant !== null) steps.push({ minutes, instant });
  }
  return steps;
}

export type HandleKey = "previous" | "next" | "earlier30" | "later30" | "first" | "last";

/** Moves the time handle among a date's existing steps; Page keys move 30 real minutes. */
export function moveHandle(steps: readonly Step[], index: number, key: HandleKey): number {
  const last = steps.length - 1;
  const current = steps[index];
  switch (key) {
    case "previous":
      return Math.max(0, index - 1);
    case "next":
      return Math.min(last, index + 1);
    case "first":
      return 0;
    case "last":
      return last;
    case "later30": {
      const target = (current?.instant ?? 0) + 30 * MINUTE_MS;
      const found = steps.findIndex((s) => s.instant >= target);
      return found === -1 ? last : found;
    }
    case "earlier30": {
      const target = (current?.instant ?? 0) - 30 * MINUTE_MS;
      let found = 0;
      steps.forEach((s, i) => {
        if (s.instant <= target) found = i;
      });
      return found;
    }
  }
}

const NOTICE_HOURS = 2;

/** The notice cutoff: exactly two hours of real time before the boarding instant. */
export function noticeCutoff(boardingInstant: number): { instant: number; at: string; utcOffset: string } {
  const instant = boardingInstant - NOTICE_HOURS * HOUR_MS;
  return { instant, at: portStamp(instant), utcOffset: utcOffsetText(instant) };
}

/** Night window: port-local 22:00 through 05:59. */
export function inNightWindow(minutes: number): boolean {
  return minutes >= 22 * 60 || minutes < 6 * 60;
}
