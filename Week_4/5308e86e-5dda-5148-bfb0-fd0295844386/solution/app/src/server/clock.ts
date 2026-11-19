/** The business clock and America/New_York calendar arithmetic. Nothing else reads a system clock. */
import { config } from "./config.js";

const processStart = performance.now();
const systemStart = Date.now();
const configuredStart = config.appNow === "" ? Number.NaN : Date.parse(config.appNow);
const base = Number.isNaN(configuredStart) ? systemStart : configuredStart;

/** The business clock: APP_NOW at start (when set), advancing in real time; otherwise the system clock. */
export function businessNow(): Date {
  return new Date(base + (performance.now() - processStart));
}

const NEW_YORK = "America/New_York";
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface NewYorkTime {
  date: string;
  hour: number;
  minute: number;
}

export function newYorkTime(instant: Date): NewYorkTime {
  const found: Record<string, string> = {};
  for (const part of parts.formatToParts(instant)) found[part.type] = part.value;
  return {
    date: `${found.year}-${found.month}-${found.day}`,
    hour: Number.parseInt(found.hour ?? "0", 10),
    minute: Number.parseInt(found.minute ?? "0", 10),
  };
}

export function newYorkDate(instant: Date): string {
  return newYorkTime(instant).date;
}

function ymd(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map((piece) => Number.parseInt(piece, 10));
  return [year ?? 0, month ?? 1, day ?? 1];
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = ymd(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a calendar date. */
export function weekdayOf(date: string): number {
  const [year, month, day] = ymd(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The instant of 00:00 New York time on a calendar date, resolved by that date's own offset. */
export function newYorkMidnight(date: string): Date {
  const [year, month, day] = ymd(date);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, offsetHours));
    const local = newYorkTime(candidate);
    if (local.date === date && local.hour === 0 && local.minute === 0) return candidate;
  }
  throw new Error(`no New York midnight for ${date}`);
}

/** The instant of a New York wall-clock hour on a calendar date. */
export function newYorkHour(date: string, hour: number): Date {
  const [year, month, day] = ymd(date);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour + offsetHours));
    const local = newYorkTime(candidate);
    if (local.date === date && local.hour === hour && local.minute === 0) return candidate;
  }
  throw new Error(`no New York ${hour}:00 for ${date}`);
}

/** The last millisecond of a New York calendar day. */
export function endOfNewYorkDay(date: string): Date {
  return new Date(newYorkMidnight(addDays(date, 1)).getTime() - 1);
}

export function firstOfMonth(month: string): string {
  return `${month}-01`;
}
