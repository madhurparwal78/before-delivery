

import type { DocumentRow, Recipient } from "./domain.js";

/** Sets the currentOrder to the recipient whose turn it is. */
export function turnOf(recipients: Recipient[]): number | null {
  const next = recipients.find((r) => r.status === "waiting" || r.status === "invited" || r.status === "viewed" || r.status === "expired");
  return next ? next.order : null;
}

export function isClosed(status: DocumentRow["status"]): boolean {
  return status === "completed" || status === "declined" || status === "voided";
}

/** Validates that a string is an IANA zone name Node understands. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function dateInZone(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export function dateTimeInZone(date: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Code-point length, not UTF-16 length. */
export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function truncateByCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.slice(0, max).join("");
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
