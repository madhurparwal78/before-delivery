import { formatLocalDateTime } from "../shared/formats.js";
import { config } from "./config.js";

let offsetMs = 0;

/** The server clock: real time moved by the grading clock when set. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function setClockOffset(ms: number): void {
  offsetMs = ms;
}

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: config.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(date)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function offsetMinutes(date: Date): number {
  const p = localParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** `YYYY-MM-DD` in APP_TZ. */
export function localDate(date: Date): string {
  const p = localParts(date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** `YYYY-MM-DDTHH:MM` in APP_TZ. */
export function localDateTime(date: Date): string {
  const p = localParts(date);
  return `${localDate(date)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO 8601 with the APP_TZ offset, for example `2026-03-14T17:00:00+00:00`. */
export function isoWithOffset(date: Date): string {
  const p = localParts(date);
  const off = offsetMinutes(date);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${localDate(date)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `14 Mar 2026, 17:00` in APP_TZ. */
export function formatDateTime(date: Date): string {
  return formatLocalDateTime(localDateTime(date));
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Reads a local `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM[:SS]` in APP_TZ, or null when malformed. */
export function fromLocal(text: string): Date | null {
  const match = LOCAL_PATTERN.exec(text.trim());
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map((v) => Number(v ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let instant = guess - offsetMinutes(new Date(guess)) * 60000;
  instant = guess - offsetMinutes(new Date(instant)) * 60000;
  const back = new Date(instant);
  if (localDate(back) !== `${pad(y, 4)}-${pad(mo)}-${pad(d)}`) return null;
  return back;
}
