import { ZONES, type Zone } from "../shared/protocol.js";

const ABBREVIATIONS: Record<Zone, Record<number, string>> = {
  "America/New_York": { [-300]: "EST", [-240]: "EDT" },
  "America/Los_Angeles": { [-480]: "PST", [-420]: "PDT" },
  "Europe/London": { 0: "GMT", 60: "BST" },
  "Europe/Berlin": { 60: "CET", 120: "CEST" },
  "Asia/Kolkata": { 330: "IST" },
  "Asia/Tokyo": { 540: "JST" },
  "Australia/Sydney": { 600: "AEST", 660: "AEDT" },
};

export const isZone = (value: unknown): value is Zone => typeof value === "string" && (ZONES as readonly string[]).includes(value);

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(zone: Zone, at: number): Record<string, number> {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, formatter);
  }
  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(at))) if (part.type !== "literal") found[part.type] = Number(part.value);
  return found;
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(zone: Zone, at: number): number {
  const p = parts(zone, at);
  const local = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return Math.round((local - Math.floor(at / 1000) * 1000) / 60000);
}

interface Resolved {
  startsAt: Date;
  note: "missing" | "repeated" | null;
}

/**
 * A wall-clock time in a zone as an instant. A time that does not exist moves forward by the gap;
 * a time that happens twice means the first.
 */
export function resolveLocal(zone: Zone, year: number, month: number, day: number, hour: number, minute: number): Resolved {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([offsetMinutes(zone, wall - 86_400_000), offsetMinutes(zone, wall + 86_400_000)]);
  const valid = [...offsets].map((offset) => wall - offset * 60_000).filter((at) => offsetMinutes(zone, at) === (wall - at) / 60_000);
  if (valid.length === 0) {
    const before = offsetMinutes(zone, wall - 86_400_000);
    return { startsAt: new Date(wall - before * 60_000), note: "missing" };
  }
  valid.sort((a, b) => a - b);
  return { startsAt: new Date(valid[0] ?? wall), note: valid.length > 1 ? "repeated" : null };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Sun 7 Mar 2027, 7:00 PM EST`, printed here with the brief's abbreviations. */
export function formatInstant(zone: Zone, at: Date): string {
  const p = parts(zone, at.getTime());
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1)).getUTCDay()];
  const hour = (p.hour ?? 0) % 12 === 0 ? 12 : (p.hour ?? 0) % 12;
  const minute = String(p.minute ?? 0).padStart(2, "0");
  const abbreviation = ABBREVIATIONS[zone][offsetMinutes(zone, at.getTime())] ?? "";
  return `${weekday} ${p.day} ${MONTHS[(p.month ?? 1) - 1]} ${p.year}, ${hour}:${minute} ${(p.hour ?? 0) < 12 ? "AM" : "PM"} ${abbreviation}`;
}

/** The instant's wall clock in the zone, as `2027-03-07T19:00`. */
export function localText(zone: Zone, at: Date): string {
  const p = parts(zone, at.getTime());
  const two = (value: number | undefined): string => String(value ?? 0).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

export const NOTE_TEXT = {
  missing: "This time doesn't exist that day, so it moves forward.",
  repeated: "This time happens twice that day. This is the first.",
} as const;

export const START_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
