/**
 * Instant helpers. Internally we work with ms-since-epoch numbers ("epoch ms")
 * for exact arithmetic, and convert to the API's `YYYY-MM-DDTHH:MM:SSZ` form
 * at the boundary.
 */

export const HALF_HOUR_MS = 30 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const UTC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isValidShipDate(s: string): boolean {
  if (!UTC_DATE_RE.test(s)) return false;
  return fromUtcString(`${s}T00:00:00Z`) !== null && toShipDate(fromUtcString(`${s}T00:00:00Z`)!) === s;
}

export function isValidMonth(s: string): boolean {
  if (!MONTH_RE.test(s)) return false;
  const ms = fromUtcString(`${s}-01T00:00:00Z`);
  return ms !== null && toMonthString(ms) === s;
}

/** Reformat an epoch ms value as the API UTC instant string. */
export function toUtcString(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Parse `YYYY-MM-DDTHH:MM:SSZ`. Returns null when malformed. */
export function fromUtcString(s: string): number | null {
  if (!UTC_INSTANT_RE.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export function toShipDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function toMonthString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** `YYYY-MM-DDTHH:MM:SSZ` -> `YYYY-MM`. */
export function monthOfShipDate(shipDate: string): string {
  return shipDate.slice(0, 7);
}

export function isAligned(ms: number): boolean {
  return ms % HALF_HOUR_MS === 0;
}

/** Round down to the half hour. */
export function floorHalfHour(ms: number): number {
  return Math.floor(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
}

/** Round up to the half hour. */
export function ceilHalfHour(ms: number): number {
  return Math.ceil(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
}

/** `YYYY-MM-DDTHH:MM:SSZ` is aligned when minutes are 00 or 30 and seconds 00. */
export function isAlignedString(s: string): boolean {
  return /:\d{2}:\d{2}Z$/.test(s) && (s.endsWith("00:00Z") || s.endsWith("30:00Z"));
}

export function formatHours(hours: number): string {
  return hours.toFixed(1);
}

/** Ship-time string `YYYY-MM-DD HH:MM` for an instant at an offset. */
export function toShipTimeString(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

/** Parse `HH:MM` into minutes; null when invalid. */
export function parseHhMm(s: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(3));
  if (h > 23 || m > 59) return null;
  if (m % 30 !== 0) return null;
  return h * 60 + m;
}

/** Add `n` days to a ship's date string, returning the new date string. */
export function addDaysToShipDate(shipDate: string, days: number): string {
  return toShipDate(fromUtcString(`${shipDate}T00:00:00Z`)! + days * DAY_MS);
}

/** Days between two ship's dates. */
export function shipDateDiff(a: string, b: string): number {
  return Math.round((fromUtcString(`${a}T00:00:00Z`)! - fromUtcString(`${b}T00:00:00Z`)!) / DAY_MS);
}

export function parseOffset(s: unknown): number | null {
  if (typeof s !== "string" && typeof s !== "number") return null;
  const n = typeof s === "string" ? Number(s.trim()) : s;
  if (!Number.isInteger(n)) return null;
  return n;
}

/** Offset minutes formatted as the API's offset form (integer minutes). */
export function formatOffset(n: number): string {
  return String(n);
}
