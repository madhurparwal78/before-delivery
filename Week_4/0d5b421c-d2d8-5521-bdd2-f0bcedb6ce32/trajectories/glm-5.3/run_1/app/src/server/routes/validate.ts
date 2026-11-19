import type { Request } from "express";
import { SLOT_TIMES } from "../../shared/seed.js";
import { addDays, todayInLisbon } from "../config.js";
import { now } from "../clock.js";
import { errors } from "../errors.js";
import { Handled } from "../http.js";
import type { DateString } from "../types.js";

export function validDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Date within today to today plus 30 days in Lisbon, both ends allowed. */
export function dateInHorizon(s: string): boolean {
  const t = now();
  const today = todayInLisbon(t);
  return s >= today && s <= addDays(today, 30);
}

export function isSlotTime(t: string): boolean {
  return SLOT_TIMES.includes(t);
}

export function isInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** Party size 1 to 8. */
export function validParty(v: unknown): v is number {
  return isInteger(v) && v >= 1 && v <= 8;
}

/** Query party param. */
export function partyFromQuery(req: Request): number | null {
  const raw = String(req.query.party ?? "");
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return validParty(n) ? n : null;
}

/** Read and validate a date query parameter. */
export function dateFromQuery(req: Request, key = "date"): DateString | null {
  const raw = String(req.query[key] ?? "");
  return validDateString(raw) && dateInHorizon(raw) ? raw : null;
}

/** The offset of Europe/Lisbon in minutes at an instant. */
export function lisbonOffset(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Lisbon", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** `starts_at` is ISO 8601 with the Lisbon offset. */
export function isoWithLisbonOffset(instant: Date): string {
  const offsetMinutes = lisbonOffset(instant);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return instant.toISOString().replace("Z", "") + `${sign}${hh}:${mm}`;
}

/** Validation helper: throw a 422 with the collected fields. */
export function invalid(fields: Record<string, string>): never {
  throw new Handled(errors.validation(fields));
}

/** Narrow a validated party size to a number after the fields check. */
export function partyOrThrow(party: number | null): number {
  if (party === null) throw new Handled(errors.validation({ party: "Choose 1 to 8 guests." }));
  return party;
}
