import type { Clock, NextTurn } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** `<office date>`: Fri 1 Jan */
export function officeDate(date: string): string {
  const { y, m, d } = parts(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

export function officeDateYear(date: string): string {
  return `${officeDate(date)} ${parts(date).y}`;
}

/** `<office stamp>`: Thu 5 Nov, 14:05 CST */
export function officeStamp(date: string, time: string, offset: string): string {
  return `${officeDate(date)}, ${time} ${offset}`;
}

export function turnStamp(turn: NextTurn): string {
  return officeStamp(turn.office_date, turn.office_time, turn.offset);
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
});

/** Display of a server instant in office time (rendering only; no decisions are made from it). */
export function instantStamp(iso: string): string {
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) map[part.type] = part.value;
  return officeStamp(`${map.year}-${map.month}-${map.day}`, `${map.hour}:${map.minute}`, map.timeZoneName ?? "");
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + by, 1));
  return next.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export function validDate(text: string | null): text is string {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const { y, m, d } = parts(text);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function validMonth(text: string | null): text is string {
  return !!text && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

/** Local office clock state advanced by a monotonic timer; refreshed from the server regularly. */
export interface ClockState { base: Clock; mono: number }

export function advance(state: ClockState, mono: number): { date: string; time: string; offset: string } {
  const seconds = new Date(state.base.now).getUTCSeconds() + (new Date(state.base.now).getUTCMilliseconds() / 1000);
  const elapsedMinutes = Math.floor((seconds * 1000 + (mono - state.mono)) / 60000);
  const [h, m] = state.base.office_time.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + elapsedMinutes;
  const dayShift = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;
  const time = `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
  return { date: addDays(state.base.office_date, dayShift), time, offset: state.base.offset };
}
