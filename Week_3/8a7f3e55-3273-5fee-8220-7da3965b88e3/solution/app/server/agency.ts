export const AGENCY = {
  name: "Tandem Hands Collective",
  timeZone: "America/Chicago",
  soloThresholdMinutes: 60,
} as const;

import { type LocalDate, addDays, parseLocalDate, weekdayIndex } from "../shared/calendar.js";

const MINUTE = 60_000;
const DAY = 86_400_000;

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

function utcMsOf(date: LocalDate): number {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new Error(`not a date: ${date}`);
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENCY.timeZone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  offsetMinutes: number;
}

function wallAt(instantMs: number): Wall {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(whole)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const year = parts["year"] ?? 0;
  const month = parts["month"] ?? 0;
  const day = parts["day"] ?? 0;
  const hour = parts["hour"] ?? 0;
  const minute = parts["minute"] ?? 0;
  const second = parts["second"] ?? 0;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return { year, month, day, hour, minute, second, offsetMinutes: (asUtc - whole) / MINUTE };
}


export const localDateAt = (instantMs: number): LocalDate => {
  const wall = wallAt(instantMs);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
};

export const localTimeAt = (instantMs: number): string => {
  const wall = wallAt(instantMs);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
};

export function isoAt(instantMs: number): string {
  const wall = wallAt(instantMs);
  const sign = wall.offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(wall.offsetMinutes);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** The instant of an agency wall-clock time; the first occurrence when it repeats, null when a clock change skips it. */
export function resolveWallClock(date: LocalDate, hour: number, minute: number): number | null {
  const wallMs = utcMsOf(date) + hour * 60 * MINUTE + minute * MINUTE;
  const offsets = new Set([wallAt(wallMs - DAY).offsetMinutes, wallAt(wallMs + DAY).offsetMinutes]);
  const matches: number[] = [];
  for (const offset of offsets) {
    const instant = wallMs - offset * MINUTE;
    const wall = wallAt(instant);
    if (localDateAt(instant) === date && wall.hour === hour && wall.minute === minute) matches.push(instant);
  }
  return matches.length === 0 ? null : Math.min(...matches);
}

/** Like resolveWallClock, but a skipped wall-clock time becomes the instant the clock change happens. */
function resolveOrNextValid(date: LocalDate, hour: number, minute: number): number {
  const exact = resolveWallClock(date, hour, minute);
  if (exact !== null) return exact;
  const wallMs = utcMsOf(date) + hour * 60 * MINUTE + minute * MINUTE;
  const before = wallAt(wallMs - DAY).offsetMinutes;
  let low = wallMs - before * MINUTE - DAY / 2;
  let high = wallMs - before * MINUTE;
  const after = wallAt(high).offsetMinutes;
  while (high - low > MINUTE) {
    const mid = Math.floor((low + high) / 2 / MINUTE) * MINUTE;
    if (wallAt(mid).offsetMinutes === after) high = mid;
    else low = mid;
  }
  return high;
}

const isBusinessDay = (date: LocalDate): boolean => weekdayIndex(date) < 5;

function previousBusinessDay(date: LocalDate): LocalDate {
  let day = addDays(date, -1);
  while (!isBusinessDay(day)) day = addDays(day, -1);
  return day;
}

/** The start moved back two business days, keeping its wall-clock time. */
export function lateCutoff(startMs: number): number {
  const wall = wallAt(startMs);
  const start = localDateAt(startMs);
  const cutoffDate = previousBusinessDay(previousBusinessDay(start));
  return resolveOrNextValid(cutoffDate, wall.hour, wall.minute);
}

const TIME_FORMAT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::00)?$/;

export type StartResolution =
  | { kind: "format" }
  | { kind: "skipped" }
  | { kind: "ok"; instant: number };

/** Reads a submitted `start` as agency wall-clock time. */
export function resolveStart(text: unknown): StartResolution {
  if (typeof text !== "string") return { kind: "format" };
  const match = TIME_FORMAT.exec(text);
  if (!match) return { kind: "format" };
  const date = match[1] ?? "";
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (parseLocalDate(date) === null || hour > 23 || minute > 59) return { kind: "format" };
  const instant = resolveWallClock(date, hour, minute);
  return instant === null ? { kind: "skipped" } : { kind: "ok", instant };
}

export const addMinutes = (instantMs: number, minutes: number): number => instantMs + minutes * MINUTE;
