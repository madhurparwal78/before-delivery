import { DateTime } from "luxon";
import type { TimeZoneKey } from "./enums.js";
import { zoneFor } from "./time.js";

export const SLOT_TIMES: string[] = Array.from({ length: 12 }, (_, i) => {
  const minutes = 6 * 60 + i * 20;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export const MEMBER_MIN_DAYS_AHEAD = 1;
export const MEMBER_MAX_DAYS_AHEAD = 28;
export const STAFF_DAYS_BACK = 400;
export const STAFF_DAYS_AHEAD = 400;
export const CHANGE_CUTOFF_HOUR = 18;

/** Monday to Saturday in the member's local dates; no Sunday slots apart from the staff same-day exception. */
export function slotDayAllowed(localDate: string): boolean {
  const dt = DateTime.fromISO(localDate);
  const weekday = dt.weekday;
  return weekday >= 1 && weekday <= 6;
}

export function slotTimeAllowed(localTime: string): boolean {
  return SLOT_TIMES.includes(localTime);
}

export function instantForSlot(localDate: string, localTime: string, timeZone: TimeZoneKey): Date {
  return DateTime.fromISO(`${localDate}T${localTime}:00`, { zone: zoneFor(timeZone) }).toJSDate();
}

/** Local date for an instant in a zone. */
export function localDateFor(instant: Date, timeZone: TimeZoneKey): string {
  return DateTime.fromJSDate(instant, { zone: zoneFor(timeZone) }).toFormat("yyyy-MM-dd");
}

/** Member change cutoff: 18:00 local time the day before the draw. */
export function changesCloseAtFor(localDate: string, timeZone: TimeZoneKey): Date {
  const dayBefore = DateTime.fromISO(localDate, { zone: zoneFor(timeZone) }).minus({ days: 1 });
  return dayBefore.set({ hour: CHANGE_CUTOFF_HOUR, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

export function memberDateWindow(localToday: string): { min: string; max: string } {
  const today = DateTime.fromISO(localToday);
  return {
    min: today.plus({ days: MEMBER_MIN_DAYS_AHEAD }).toFormat("yyyy-MM-dd"),
    max: today.plus({ days: MEMBER_MAX_DAYS_AHEAD }).toFormat("yyyy-MM-dd"),
  };
}

export function staffDateWindow(phoenixToday: string): { min: string; max: string } {
  const today = DateTime.fromISO(phoenixToday);
  return {
    min: today.minus({ days: STAFF_DAYS_BACK }).toFormat("yyyy-MM-dd"),
    max: today.plus({ days: STAFF_DAYS_AHEAD }).toFormat("yyyy-MM-dd"),
  };
}
