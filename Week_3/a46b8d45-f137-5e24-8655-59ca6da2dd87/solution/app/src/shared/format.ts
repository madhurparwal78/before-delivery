import type { Lang } from "./types";

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const PL_MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"] as const;

const NBSP = " ";

const londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Europe/London wall clock for an instant; the only place an instant becomes a local date or time. */
export function londonParts(at: Date): LondonParts {
  const parts: Record<string, number> = {};
  for (const part of londonClock.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts["year"] ?? 0,
    month: parts["month"] ?? 0,
    day: parts["day"] ?? 0,
    hour: parts["hour"] ?? 0,
    minute: parts["minute"] ?? 0,
    second: parts["second"] ?? 0,
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function londonDateOf(at: Date): string {
  const p = londonParts(at);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hour and minute as HH:MM, seconds dropped and never rounded. */
function timeText(at: Date): string {
  const p = londonParts(at);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "15 July 2026" or "15 lipca 2026" from a YYYY-MM-DD calendar date. */
export function dateText(ymd: string, lang: Lang): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const months = lang === "pl-PL" ? PL_MONTHS : EN_MONTHS;
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

export function instantDateText(iso: string, lang: Lang): string {
  return dateText(londonDateOf(new Date(iso)), lang);
}

export function instantTimeText(iso: string): string {
  return timeText(new Date(iso));
}

function groupThousands(whole: string, separator: string): string {
  let out = "";
  for (let i = whole.length; i > 0; i -= 3) {
    out = whole.slice(Math.max(0, i - 3), i) + (out ? separator + out : "");
  }
  return out;
}

/** An integer amount of pence in the language's money format. */
export function money(minor: number, lang: Lang): string {
  const pounds = Math.trunc(minor / 100);
  const pence = pad(Math.abs(minor % 100));
  const whole = String(pounds);
  if (lang === "en-GB") return `£${groupThousands(whole, ",")}.${pence}`;
  const grouped = whole.length >= 5 ? groupThousands(whole, NBSP) : whole;
  return `${grouped},${pence}${NBSP}£`;
}

/** Operator screens and dispatch notes always use the English formats. */
export const moneyEn = (minor: number): string => money(minor, "en-GB");
