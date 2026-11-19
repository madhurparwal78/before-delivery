// Display formats from Feedback states, shared by the UI, emails, the visit-log PDF and Kill Bill text.
import type { Cents, Quarters } from "./rules.ts";
import { formatWall, wallClock } from "./time.ts";
import type { BookingStatus, Hours } from "./api.ts";

/** Dollars with two decimals and thousands commas, from integer cents: 123450 → "1,234.50". */
export function money(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Kill Bill amount in USD, cents ÷ 100 at the provider boundary. */
export function usdAmount(cents: Cents): number {
  return Number(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
}

/** Two-decimal hours from whole quarter hours: 9 → "2.25". */
export function quartersText(q: Quarters): string {
  const sign = q < 0 ? "-" : "";
  const abs = Math.abs(q);
  return `${sign}${Math.floor(abs / 4)}.${["00", "25", "50", "75"][abs % 4]}`;
}

/** Two-decimal hours from a JSON hours number (always a multiple of 0.25). */
export function hoursText(hours: Hours): string {
  return quartersText(Math.round(hours * 4));
}

/** Two-decimal gap hours from the published gap (a number with two decimals). */
function gapHoursText(gapHours: number): string {
  const h = Math.round(gapHours * 100);
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`;
}

/** The Gap cell: flagged, unflagged with a gap, or a dash when there is none. */
export function gapCellText(gapHours: number | null, flagged: boolean): string {
  if (gapHours === null) return "—";
  return flagged ? `Gap ${gapHoursText(gapHours)} h — over 24 hours` : `${gapHoursText(gapHours)} h`;
}

/** `YYYY-MM-DD HH:MM` in a site's zone. */
export function siteDateTime(iso: string, timeZone: string): string {
  const w = wallClock(Date.parse(iso), timeZone);
  return `${w.date} ${formatWall(w.minutes)}`;
}

export function siteTime(iso: string, timeZone: string): string {
  return formatWall(wallClock(Date.parse(iso), timeZone).minutes);
}

/** The status word a ticket and a Site day row show. */
export const STATUS_WORDS: Record<BookingStatus, string> = {
  held: "Held",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  no_show: "No-show",
  cancelled: "Cancelled",
  expired: "Expired",
};
