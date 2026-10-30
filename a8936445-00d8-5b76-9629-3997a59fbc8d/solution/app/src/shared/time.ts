// Kitchen wall-clock time. Every date, minute of day and offset is worked out in the kitchen's
// zone, whatever zone the server or the browser runs in.
import { DAY_MINUTES, STEP_MINUTES, TIME_ZONE } from "./kitchen";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface KitchenParts {
  date: string;
  minute: number;
  second: number;
  offsetMinutes: number;
}

export function kitchenParts(instantMs: number): KitchenParts {
  const fields: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = fields as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const wholeSecond = Math.floor(instantMs / 1000) * 1000;
  return {
    date: `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`,
    minute: hour * 60 + minute,
    second,
    offsetMinutes: Math.round((wallMs - wholeSecond) / MINUTE_MS),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isKitchenDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The instants at which a kitchen wall-clock time occurs: none when skipped, two when repeated. */
function wallInstants(date: string, minute: number): number[] {
  const wallMs = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  const offsets = new Set([kitchenParts(wallMs - DAY_MS).offsetMinutes, kitchenParts(wallMs + DAY_MS).offsetMinutes]);
  return [...offsets]
    .map((offset) => wallMs - offset * MINUTE_MS)
    .filter((instant) => {
      const parts = kitchenParts(instant);
      return parts.date === date && parts.minute === minute;
    })
    .sort((a, b) => a - b);
}

/**
 * The instant of a kitchen wall-clock time; `minute` may be 1440 (24:00, the next day's midnight).
 * A repeated time means its first (daylight-time) occurrence; a skipped time has no instant.
 */
export function kitchenInstant(date: string, minute: number): number | null {
  if (minute >= DAY_MINUTES) return kitchenInstant(addDays(date, 1), minute - DAY_MINUTES);
  return wallInstants(date, minute)[0] ?? null;
}

/** Wall-clock ranges [start, end) of a clock change on one kitchen date. */
export function clockChanges(date: string): { skipped: [number, number] | null; repeated: [number, number] | null } {
  let skipped: [number, number] | null = null;
  let repeated: [number, number] | null = null;
  for (let minute = 0; minute < DAY_MINUTES; minute += STEP_MINUTES) {
    const count = wallInstants(date, minute).length;
    if (count === 0) skipped = skipped ? [skipped[0], minute + STEP_MINUTES] : [minute, minute + STEP_MINUTES];
    if (count === 2) repeated = repeated ? [repeated[0], minute + STEP_MINUTES] : [minute, minute + STEP_MINUTES];
  }
  return { skipped, repeated };
}

/** ISO 8601 with seconds and the kitchen's offset at that instant, e.g. 2026-11-03T05:00:00-06:00. */
export function kitchenIso(instantMs: number): string {
  const parts = kitchenParts(instantMs);
  const sign = parts.offsetMinutes < 0 ? "-" : "+";
  const offset = Math.abs(parts.offsetMinutes);
  return `${parts.date}T${hhmm(parts.minute)}:${pad(parts.second)}${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`;
}

export function hhmm(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** Minutes written as hours:minutes, e.g. 360 → "6:00". */
export function hmm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

export function parseHhmm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minute <= DAY_MINUTES ? minute : null;
}

export function dollars(cents: number): string {
  return `$${Math.floor(cents / 100)}.${pad(cents % 100)}`;
}

/** "YYYY-MM-DD HH:MM" in kitchen time. */
export function kitchenStamp(instantMs: number): string {
  const parts = kitchenParts(instantMs);
  return `${parts.date} ${hhmm(parts.minute)}`;
}
