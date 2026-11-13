import { config } from "./config.js";

const bootedAt = Date.now();
const startedAt = config.clockStart !== null && Number.isFinite(config.clockStart) ? config.clockStart : bootedAt;

/** The business clock: real time, or PRESS_CLOCK_START advancing at normal speed from boot. */
export const businessNow = (): Date => new Date(startedAt + (Date.now() - bootedAt));

const ZONE = "Europe/Copenhagen";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export const copenhagenTime = (instant: Date): LocalTime => {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return {
    year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0,
    hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0,
  };
};

const offsetMinutes = (instant: Date): number => {
  const local = copenhagenTime(instant);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
};

const two = (value: number): string => String(value).padStart(2, "0");

/** ISO 8601 in Copenhagen local time with its offset, e.g. 2026-12-29T23:59:59+01:00. */
export const formatCopenhagen = (instant: Date): string => {
  const local = copenhagenTime(instant);
  const offset = offsetMinutes(instant);
  const sign = offset < 0 ? "-" : "+";
  const magnitude = Math.abs(offset);
  return `${local.year}-${two(local.month)}-${two(local.day)}T${two(local.hour)}:${two(local.minute)}:${two(local.second)}${sign}${two(Math.floor(magnitude / 60))}:${two(magnitude % 60)}`;
};

export const copenhagenMonth = (instant: Date): string => {
  const local = copenhagenTime(instant);
  return `${local.year}-${two(local.month)}`;
};

/** The instant at which the given Copenhagen wall-clock time occurs (never called inside a DST gap). */
export const copenhagenInstant = (local: LocalTime): Date => {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return new Date(guess - offsetMinutes(new Date(guess - 2 * 3600 * 1000)) * 60000);
};
