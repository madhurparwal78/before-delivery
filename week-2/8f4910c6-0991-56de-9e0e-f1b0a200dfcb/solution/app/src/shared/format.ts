// The published display formats: days, office times, months, money, reach and ordinals.

import { OFFICES, type OfficeId, parseIsoDate, weekday, zonedParts, localDateOf } from "./zones.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `Ddd D Mon` (Mon 15 Mar). */
export function dayLabel(iso: string): string {
  const { month, day } = parseIsoDate(iso);
  return `${WEEKDAYS[weekday(iso)]} ${day} ${MONTHS[month - 1]}`;
}

/** `Ddd D Mon YYYY` (Mon 15 Mar 2027). */
export function formatDate(iso: string): string {
  return `${dayLabel(iso)} ${parseIsoDate(iso).year}`;
}

/** `Ddd D Mon YYYY, HH:MM <City> time` in the office's zone. */
export function formatOfficeTime(instant: string | number, office: OfficeId): string {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  const { timeZone, city } = OFFICES[office];
  const parts = zonedParts(ms, timeZone);
  const hh = String(parts.hour).padStart(2, "0");
  const mm = String(parts.minute).padStart(2, "0");
  return `${formatDate(localDateOf(ms, timeZone))}, ${hh}:${mm} ${city} time`;
}

/** `Month YYYY` (March 2027) for a `YYYY-MM` month. */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

function groupThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `CAD 1,234.50`; a negative amount reads `CAD -1,234.50`. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `CAD ${sign}${groupThousands(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Plain two-place decimal for exports and billing (`-500.00`). */
export function plainAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Reads a typed amount (`125.50`, `1,250`, `CAD 12`) as integer cents; null when it is not money. */
export function parseMoneyInput(typed: string): number | null {
  const cleaned = typed.replace(/^\s*CAD\s*/i, "").replace(/,/g, "").trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const REACH_STEPS: Array<[number, string]> = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "K"],
];

/** Truncating compact reach: 374,650 → 374.6K, 999,999 → 999.9K, 1,000,000 → 1M, 999 → 999; no count is "Not listed". */
export function compactReach(count: number | null): string {
  if (count === null) return "Not listed";
  for (const [size, suffix] of REACH_STEPS) {
    if (count >= size) {
      const tenths = Math.floor((count * 10) / size);
      const whole = Math.floor(tenths / 10);
      const fraction = tenths % 10;
      return fraction === 0 ? `${whole}${suffix}` : `${whole}.${fraction}${suffix}`;
    }
  }
  return String(count);
}

export function ordinal(rank: number): string {
  return ["1st", "2nd", "3rd"][rank - 1];
}

/** `A`, `A and B`, `A, B and C`. */
export function listJoin(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

