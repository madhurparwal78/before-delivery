// Business time zone rules: local wall-clock time to instant, with the gap and overlap rules.

export type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsFormatters.set(zone, formatter);
  }
  return formatter;
}

export function localParts(zone: string, instant: Date): LocalDateTime {
  const parts = Object.fromEntries(partsFormatter(zone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function wallAsUtc(local: LocalDateTime): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
}

// Offset (local minus UTC) in milliseconds at an instant.
function offsetAt(zone: string, instant: number): number {
  return wallAsUtc(localParts(zone, new Date(instant))) - Math.floor(instant / 1000) * 1000;
}

// A wall-clock time in the zone as an instant. A time skipped by a spring-forward jump moves
// forward by the jump; a time that happens twice resolves to its first occurrence.
export function localToInstant(zone: string, local: LocalDateTime): Date {
  const wall = wallAsUtc(local);
  const before = offsetAt(zone, wall - 86_400_000);
  const after = offsetAt(zone, wall + 86_400_000);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((instant) => wallAsUtc(localParts(zone, new Date(instant))) === wall)
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? wall - before);
}

export function addLocalDays(local: LocalDateTime, days: number): LocalDateTime {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return { ...local, year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");

export function localDate(local: LocalDateTime): string {
  return `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
}

// Workspace-local ISO 8601 with offset, e.g. 2026-11-02T06:30:00-06:00.
export function localIso(zone: string, instant: Date): string {
  const local = localParts(zone, instant);
  const offsetMinutes = Math.round(offsetAt(zone, instant.getTime()) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  return `${localDate(local)}T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

export { formatBusinessDate, formatWhen } from "../../shared/when.js";
