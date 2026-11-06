// The published formats (brief: Business rules → Formats), used on screen, in email and in API messages.
import { CITY, type Market, ZONE, type Wall, hhmm, wallAt } from "./time";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayIndex(date: Pick<Wall, "year" | "month" | "day">): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** `Thu 18 Mar 2027` */
export function dateText(date: Pick<Wall, "year" | "month" | "day">): string {
  return `${DAYS[weekdayIndex(date)]} ${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** `Thu 18 Mar 2027, 10:00 Copenhagen time` for a wall time already in the market's zone. */
export function wallMarketTime(wall: Wall, market: Market): string {
  return `${dateText(wall)}, ${hhmm(wall)} ${CITY[market]} time`;
}

export function marketTime(ms: number, market: Market = "copenhagen"): string {
  return wallMarketTime(wallAt(ms, ZONE[market]), market);
}

export function copenhagenDateText(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  return dateText({ year, month, day });
}

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Integer minor units in the currency's own decimals: `DKK 1,234.50`, `JPY 123,450`. */
export function money(minor: number, currency: string): string {
  return `${currency} ${amount(minor, currency)}`;
}

/** The money format without the code. */
export function amount(minor: number, currency: string): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (currency === "JPY") return `${sign}${group(String(abs))}`;
  return `${sign}${group(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Major units as an exact decimal string (two decimals, whole yen for JPY), for Kill Bill item amounts. */
export function majorUnits(minor: number, currency: string): string {
  if (currency === "JPY") return String(minor);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/** `HH:MM:SS`, prefixed with `<d>d ` when a day or more remains; never below zero. */
export function countdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(total / 86_400);
  const rest = total % 86_400;
  const clock = [Math.floor(rest / 3600), Math.floor((rest % 3600) / 60), rest % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return days ? `${days}d ${clock}` : clock;
}

export function position(n: number, total: number): string {
  return `${n} / ${total}`;
}

/** A count with its noun, singular for 1: `1 drop`, `3 drops`. */
export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
