import { ZONE_NAMES } from "../shared/zones.js";

const DAY_MS = 86_400_000;
const PULL_HOUR = 6;
const ACCEPTED = new Set(ZONE_NAMES);

interface LocalMoment {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface ZoneEntry {
  zone: string;
  effectiveFrom: Date;
}

export function isAcceptedZone(zone: unknown): zone is string {
  return typeof zone === "string" && ACCEPTED.has(zone);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
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
}

/** The wall clock reading in a zone at an instant. */
function localMoment(instant: Date, zone: string): LocalMoment {
  const parts = new Map(formatterFor(zone).formatToParts(instant).map((part) => [part.type, Number(part.value)]));
  return {
    year: parts.get("year") ?? 0,
    month: parts.get("month") ?? 0,
    day: parts.get("day") ?? 0,
    hour: parts.get("hour") ?? 0,
    minute: parts.get("minute") ?? 0,
    second: parts.get("second") ?? 0,
  };
}

function wallMs(local: LocalMoment): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
}

function offsetMs(epochMs: number, zone: string): number {
  const whole = Math.floor(epochMs / 1000) * 1000;
  return wallMs(localMoment(new Date(whole), zone)) - whole;
}

/**
 * The instant a local time means in a zone, with the offset in force at that local moment.
 * A time the clocks skipped means the first instant after the gap; a time that occurs
 * twice means the earlier occurrence.
 */
function instantOfLocal(local: LocalMoment, zone: string): Date {
  const wall = wallMs(local);
  const before = offsetMs(wall - DAY_MS, zone);
  const after = offsetMs(wall + DAY_MS, zone);
  const valid = [before, after].filter((offset) => offsetMs(wall - offset, zone) === offset).map((offset) => wall - offset);
  if (valid.length > 0) return new Date(Math.min(...valid));
  let low = Math.floor((wall - after) / 1000);
  let high = Math.floor((wall - before) / 1000);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsetMs(middle * 1000, zone) === after) high = middle;
    else low = middle + 1;
  }
  return new Date(low * 1000);
}

function midnightOf(year: number, month: number, day: number): LocalMoment {
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

function addDays(local: LocalMoment, days: number): LocalMoment {
  const moved = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return { ...local, year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

function dateString(local: LocalMoment): string {
  return `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

export function currentYear(instant: Date, zone: string): number {
  return localMoment(instant, zone).year;
}

/** The first instant of the local date the instant falls on. */
export function startOfLocalDay(instant: Date, zone: string): Date {
  const local = localMoment(instant, zone);
  return instantOfLocal(midnightOf(local.year, local.month, local.day), zone);
}

/** The next local midnight strictly after the instant. */
export function nextLocalMidnight(instant: Date, zone: string): Date {
  const tomorrow = addDays(localMoment(instant, zone), 1);
  return instantOfLocal(midnightOf(tomorrow.year, tomorrow.month, tomorrow.day), zone);
}

export function localDateOf(instant: Date, zone: string): string {
  return dateString(localMoment(instant, zone));
}

/** The local date in the zone, minus one day before 06:00:00 local. */
export function pullDay(instant: Date, zone: string): string {
  const local = localMoment(instant, zone);
  return dateString(local.hour < PULL_HOUR ? addDays(local, -1) : local);
}

/** The next 06:00:00 local after the instant. */
export function nextPullAt(instant: Date, zone: string): Date {
  const local = localMoment(instant, zone);
  const today = instantOfLocal({ ...local, hour: PULL_HOUR, minute: 0, second: 0 }, zone);
  if (today.getTime() > instant.getTime()) return today;
  const tomorrow = addDays(local, 1);
  return instantOfLocal({ ...tomorrow, hour: PULL_HOUR, minute: 0, second: 0 }, zone);
}

/** The zone of the entry with the latest `effectiveFrom` at or before the instant. */
export function effectiveZone(history: readonly ZoneEntry[], instant: Date): string {
  const entries = history.filter((entry) => entry.effectiveFrom.getTime() <= instant.getTime());
  const latest = entries.reduce((best, entry) => (entry.effectiveFrom > best.effectiveFrom ? entry : best));
  return latest.zone;
}
