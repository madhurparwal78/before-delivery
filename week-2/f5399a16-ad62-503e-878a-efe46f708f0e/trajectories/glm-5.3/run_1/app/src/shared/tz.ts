// Dates and times on screens: every date prints on the local date of the town
// named, every instant is UTC in whole seconds, and nothing depends on the
// device clock or the browser's language. The four towns the desk works with
// are served by the standard zone rules, computed here once.

import type { Town } from "./copy";

export type Instant = number; // whole UTC seconds

// A town's UTC offset in minutes for the instant given, by the standard rule
// tables of each zone: Europe/Amsterdam, America/New_York, America/Toronto
// and Asia/Dubai.
export function townOffsetMinutes(town: Town, at: Instant): number {
  switch (town) {
    case "dubai":
      return 240;
    case "amsterdam":
      return inSummer(at, euStart, euEnd) ? 120 : 60;
    case "newYork":
    case "toronto":
      return inSummer(at, naStart, naEnd) ? -240 : -300;
  }
}

function euStart(year: number): number {
  return lastSundayUtc(year, 2, 1);
}

function euEnd(year: number): number {
  return lastSundayUtc(year, 9, 1);
}

function naStart(year: number): number {
  return nthSundayUtc(year, 2, 2, 7);
}

function naEnd(year: number): number {
  return nthSundayUtc(year, 10, 1, 6);
}

function lastSundayUtc(year: number, monthIndex0: number, hourUtc: number): number {
  const d = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc) / 1000);
}

function nthSundayUtc(year: number, monthIndex0: number, n: number, hourUtc: number): number {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const firstSunday = 1 + ((7 - d.getUTCDay()) % 7);
  return Math.floor(Date.UTC(year, monthIndex0, firstSunday + (n - 1) * 7, hourUtc) / 1000);
}

function inSummer(at: Instant, startOf: (y: number) => number, endOf: (y: number) => number): boolean {
  const year = new Date(at * 1000).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const start = startOf(y);
    const end = endOf(y);
    if (at >= start && at < end) return true;
  }
  return false;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function sameWall(town: Town, at: Instant, date: string, h: number, m: number): boolean {
  const local = at + townOffsetMinutes(town, at) * 60;
  const d = new Date(local * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` === date &&
    d.getUTCHours() === h &&
    d.getUTCMinutes() === m
  );
}

// The instant of a local wall time in a town. Returns null when that wall time
// does not exist on that day (skipped by a clock change), and the first
// instant when it happens twice.
export function instantOfWall(town: Town, date: string, time: string): Instant | null {
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  const naive = Math.floor(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      h,
      m,
    ) / 1000,
  );
  const matches: Instant[] = [];
  // The true instant lies within a few hours either side of the naive one, so
  // every candidate offset within that window is tested and the earliest match
  // is taken, which is the first of a repeated wall time.
  for (const minutes of [240, 180, 120, 60, 0, -60, -120, -180, -240, -300, -360]) {
    const at = naive - minutes * 60;
    if (sameWall(town, at, date, h, m)) matches.push(at);
  }
  if (matches.length === 0) return null;
  return Math.min(...matches);
}

// A UTC instant printed in a town's local wall time, `HH:mm`.
export function wallTime(town: Town, at: Instant): string {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// A UTC instant's local date in a town, `yyyy-mm-dd`.
export function wallDate(town: Town, at: Instant): string {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `Mon 29 Mar 2027`, on the local date of the town named.
export function longDate(town: Town, at: Instant): string {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1000);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// `<date>, <time> <town> time`, the date-time placeholder of Feedback states.
export function dateTimeTown(town: Town, at: Instant, townText: string): string {
  return `${longDate(town, at)}, ${wallTime(town, at)} ${townText} time`;
}

// A whole-second UTC instant printed with a Z, never milliseconds.
export function instantText(at: Instant): string {
  const d = new Date(at * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

export function dateOnly(date: string): Instant {
  return Math.floor(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000,
  );
}

// The Monday of the week holding the Amsterdam date of an instant.
export function weekStartOfAmsterdam(at: Instant): string {
  const d = new Date((at + townOffsetMinutes("amsterdam", at) * 60) * 1000);
  const back = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
  );
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

