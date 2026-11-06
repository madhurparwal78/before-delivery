// Formats from the brief's API › Formats table. Money stays integer cents until it becomes text here.

import type { Status } from "./rules.js";

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function splitCents(cents: number): { sign: string; whole: string; frac: string } {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return { sign: cents < 0 ? "-" : "", whole: digits.slice(0, -2), frac: digits.slice(-2) };
}

/** "$1,234.56", "-$63.63" */
export function money(cents: number): string {
  const { sign, whole, frac } = splitCents(cents);
  return `${sign}$${groupThousands(whole)}.${frac}`;
}

/** "127.25", "-63.63": dollars with two decimals and no symbol (Kill Bill amounts, CSV cells). */
export function plainMoney(cents: number): string {
  const { sign, whole, frac } = splitCents(cents);
  return `${sign}${whole}.${frac}`;
}

/**
 * "127.25", "-63.6", "100" (a decimal dollar amount as written in a provider's JSON) -> integer
 * cents, read digit by digit and rounded once, half away from zero, at the third decimal.
 */
export function centsOfDecimal(text: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`not a decimal amount: ${text}`);
  // Shift the decimal point by the exponent on the digit string itself.
  const digits = `${m[2]}${m[3] ?? ""}`;
  const point = m[2]!.length + Number(m[4] ?? 0);
  const padded = point < 0 ? `${"0".repeat(-point)}${digits}` : digits.padEnd(point + 3, "0");
  const at = Math.max(point, 0);
  const whole = padded.slice(0, at) || "0";
  const frac = padded.slice(at).padEnd(3, "0");
  const cents = Number(whole) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return m[1] === "-" ? -cents : cents;
}

/** "52.25" (a dollar amount typed into a form) -> 5225, or null when it is not one. */
export function parseDollars(text: string): number | null {
  const m = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Quarter-hour counts as the brief's <hours>: up to two decimals, no trailing zeros. */
export function hoursText(quarters: number): string {
  const whole = Math.trunc(quarters / 4);
  const rest = Math.abs(quarters % 4);
  const sign = quarters < 0 && whole === 0 ? "-" : "";
  return `${sign}${whole}${["", ".25", ".5", ".75"][rest]}`;
}

/** API hours (numbers in quarter-hour steps) as quarter-hour counts. */
export function quartersOf(hours: number): number {
  return Math.round(hours * 4);
}

export const STATUS_WORDS: Record<Status | "booked", string> = {
  held: "Held",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
  no_show: "No-show",
  cancelled_free: "Cancelled",
  cancelled_late: "Late cancel",
  expired: "Expired",
  booked: "Booked",
};

export const DOCUMENT_TYPES = { insurance_certificate: "insurance certificate", food_handler_card: "food-handler card" } as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export interface BlockShape {
  stationName: string;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
}

/** "<station> <date> <start>–<end>" or "<station> <date> for <n> days" */
export function blockLabel(b: BlockShape): string {
  if (b.days !== null) return `${b.stationName} ${b.localDate} for ${b.days} ${b.days === 1 ? "day" : "days"}`;
  return `${b.stationName} ${b.localDate} ${b.localStart}–${b.localEnd}`;
}

export const SANITATION_AREAS = ["Prep stations", "Ovens and ranges", "Walk-in cooler", "Dish area", "Floors and drains"];
