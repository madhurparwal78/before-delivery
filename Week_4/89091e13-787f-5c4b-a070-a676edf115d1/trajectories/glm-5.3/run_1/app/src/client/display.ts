// Display helpers. Dates show as D MMM YYYY and times as HH:mm:ss in the
// workspace time zone, both from the server's clock, never the device's.

import { formatFern } from "../shared/domain.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatFernUfern(ufern: string | bigint): string {
  return formatFern(BigInt(ufern));
}

export function formatFernWithUnit(ufern: string | bigint): string {
  return `${formatFernUfern(ufern)} FERN`;
}

function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(iso));
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
    const date = `${Number(get("day"))} ${get("month")} ${get("year")}`;
    const time = `${get("hour").padStart(2, "0")}:${get("minute")}:${get("second")}`;
    return { date, time };
  } catch {
    const fallback = new Date(iso);
    const date = `${fallback.getUTCDate()} ${MONTHS[fallback.getUTCMonth()]} ${fallback.getUTCFullYear()}`;
    const time = `${String(fallback.getUTCHours()).padStart(2, "0")}:${String(fallback.getUTCMinutes()).padStart(2, "0")}:${String(fallback.getUTCSeconds()).padStart(2, "0")}`;
    return { date, time };
  }
}

export function displayDate(iso: string, timeZone: string): string {
  return zonedParts(iso, timeZone).date;
}

export function displayTime(iso: string, timeZone: string): string {
  return zonedParts(iso, timeZone).time;
}

export function displayDateTime(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone);
  return `${parts.date} ${parts.time}`;
}

export function percent(value: string): string {
  return `${value}%`;
}

export function truncateMiddle(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
