// Dates and times as the brief prints them, in the workspace zone from the server.
import { formatCalendarDate, formatDate, formatStamp, formatTime } from "../../shared/dates.ts";
import { bootstrap } from "./bootstrap.ts";

/** `D MMM YYYY` for an instant. */
export const dateOf = (iso: string): string => formatDate(iso, bootstrap.timeZone);
/** `D MMM YYYY` for a calendar date (`YYYY-MM-DD`). */
export const calendarDate = (date: string): string => formatCalendarDate(date);
/** `HH:mm` for an instant. */
export const timeOf = (iso: string): string => formatTime(iso, bootstrap.timeZone);
/** `D MMM YYYY HH:mm` for an instant. */
export const stampOf = (iso: string): string => formatStamp(iso, bootstrap.timeZone);
