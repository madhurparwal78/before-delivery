// The published display formats, used by the server's copies and by every screen.

import { cityOf, localDate, localTime, weekdayOf, type TimeZone } from "./time";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(date: string): string {
  const [year = "", month = "1", day = "1"] = date.split("-");
  return `${WEEKDAYS[weekdayOf(date)]} ${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function formatCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${rest}`;
}

export function formatDateIn(instant: string, zone: TimeZone): string {
  return formatDate(localDate(new Date(instant), zone));
}

export function zoneTime(instant: string, zone: TimeZone): string {
  return `${localTime(new Date(instant), zone)} ${cityOf(zone)} time`;
}

export function dateTimeIn(instant: string, zone: TimeZone): string {
  return `${formatDateIn(instant, zone)}, ${zoneTime(instant, zone)}`;
}

// `<date>, <HH:MM> Phoenix time · <HH:MM> <city> time`, with one time for a Phoenix member.
export function twoTimeLine(date: string, startsAt: string, zone: TimeZone): string {
  const phoenix = `${formatDate(date)}, ${zoneTime(startsAt, "phoenix")}`;
  return zone === "phoenix" ? phoenix : `${phoenix} · ${zoneTime(startsAt, zone)}`;
}
