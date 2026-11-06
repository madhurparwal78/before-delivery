import { STUDIO_ZONE } from "./config.js";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: STUDIO_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface StudioParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parts(instant: Date): StudioParts {
  const found: Record<string, string> = {};
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour === "24" ? "00" : found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

function pad(value: number, width = 2): string {
  return value.toString().padStart(width, "0");
}

function studioOffsetMinutes(instant: Date): number {
  const p = parts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

export function studioOffsetLabel(instant: Date): string {
  const minutes = studioOffsetMinutes(instant);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** ISO 8601 with the studio offset, for example 2026-11-01T14:05:09-03:00. */
export function studioInstant(instant: Date): string {
  const p = parts(instant);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(
    p.second,
  )}${studioOffsetLabel(instant)}`;
}

/** The Buenos Aires calendar date, as YYYY-MM-DD. */
export function studioDate(instant: Date): string {
  const p = parts(instant);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function studioClockLabel(instant: Date): string {
  const p = parts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function dateToUtcMidnight(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** Whole days from one calendar date to another. */
export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const diff = dateToUtcMidnight(toIsoDate).getTime() - dateToUtcMidnight(fromIsoDate).getTime();
  return Math.round(diff / 86_400_000);
}

export function addDaysToDate(isoDate: string, days: number): string {
  const base = dateToUtcMidnight(isoDate);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function addMonthsToDate(isoDate: string, months: number): string {
  const base = dateToUtcMidnight(isoDate);
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

/** The instant a Kill Bill date-time string names, or null. */
export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The Buenos Aires date of a Kill Bill date or date-time string. */
export function studioDateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = parseInstant(value);
  return instant ? studioDate(instant) : null;
}
