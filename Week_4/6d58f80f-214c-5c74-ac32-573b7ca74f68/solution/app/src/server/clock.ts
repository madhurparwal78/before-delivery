// The server clock and company time (brief: Business rules, Company time). America/Phoenix keeps UTC-7 all year.
import type { CompanyDate } from "../shared/api.js";
import { PHOENIX_OFFSET_MS } from "../shared/rules.js";

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

let offsetMs = 0;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Clock control: from here on "now" runs on from `instant`. */
export function setNow(instant: Date): void {
  offsetMs = instant.getTime() - Date.now();
}

export function companyDate(instant: Date): CompanyDate {
  return new Date(instant.getTime() + PHOENIX_OFFSET_MS).toISOString().slice(0, 10);
}

export function today(): CompanyDate {
  return companyDate(now());
}

export function isCompanyDate(text: unknown): text is CompanyDate {
  if (typeof text !== "string" || !DATE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

export function addDays(date: CompanyDate, days: number): CompanyDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: CompanyDate, to: CompanyDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Parses an ISO 8601 instant that carries `Z` or an explicit offset. */
export function parseInstant(text: unknown): Date | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(text)) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
