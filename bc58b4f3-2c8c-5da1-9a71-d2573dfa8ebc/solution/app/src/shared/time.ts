// Central time (America/Chicago) parsing and formatting shared by the server and the browser.
import { DateTime } from "luxon";

export const AGENCY_ZONE = "America/Chicago";

function inAgencyZone(iso: string): DateTime {
  return DateTime.fromISO(iso, { setZone: true }).setZone(AGENCY_ZONE);
}

export function toAgencyIso(moment: DateTime): string {
  return moment.setZone(AGENCY_ZONE).toISO({ suppressMilliseconds: true }) ?? "";
}

/** `Thu 12 Nov 09:00` */
export function formatStamp(iso: string): string {
  return inAgencyZone(iso).toFormat("ccc d LLL HH:mm", { locale: "en-US" });
}

/** `Thu 12 Nov 09:00–10:30` */
export function formatRange(startIso: string, endIso: string): string {
  return `${formatStamp(startIso)}–${inAgencyZone(endIso).toFormat("HH:mm")}`;
}

/** `Thu 12 Nov` */
export function formatDay(iso: string): string {
  return inAgencyZone(iso).toFormat("ccc d LLL", { locale: "en-US" });
}

/** `Thu 12 Nov 2026` from `2026-11-12` */
export function formatLongDate(ymd: string): string {
  return DateTime.fromISO(ymd, { zone: AGENCY_ZONE }).toFormat("ccc d LLL yyyy", { locale: "en-US" });
}

/** `Mon 9` from `2026-11-09` */
export function formatTabDay(ymd: string): string {
  return DateTime.fromISO(ymd, { zone: AGENCY_ZONE }).toFormat("ccc d", { locale: "en-US" });
}

/** The Central calendar date (`YYYY-MM-DD`) of an instant. */
export function agencyDate(iso: string): string {
  return inAgencyZone(iso).toISODate() ?? "";
}

/** The Central `HH:MM` of an instant. */
export function agencyTime(iso: string): string {
  return inAgencyZone(iso).toFormat("HH:mm");
}

/** Minutes after Central midnight of an instant. */
export function minutesIntoAgencyDay(iso: string): number {
  const moment = inAgencyZone(iso);
  return moment.hour * 60 + moment.minute;
}

/** Monday (`YYYY-MM-DD`) of the Central week holding the instant. */
export function agencyMonday(moment: DateTime): string {
  return moment.setZone(AGENCY_ZONE).startOf("week").toISODate() ?? "";
}

/** Add whole days to a `YYYY-MM-DD` date. */
export function shiftDate(ymd: string, days: number): string {
  return DateTime.fromISO(ymd, { zone: AGENCY_ZONE }).plus({ days }).toISODate() ?? "";
}

/**
 * A typed Central date (`YYYY-MM-DD`) and time (`HH:MM`) as an ISO instant with its Central offset,
 * or null when either part is not in that form.
 */
export function agencyInputToIso(ymd: string, hhmm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim()) || !/^\d{2}:\d{2}$/.test(hhmm.trim())) return null;
  const moment = DateTime.fromISO(`${ymd.trim()}T${hhmm.trim()}`, { zone: AGENCY_ZONE });
  return moment.isValid ? toAgencyIso(moment) : null;
}

/** `1:30` */
export function clockText(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** `1 h 30 m` */
export function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}
