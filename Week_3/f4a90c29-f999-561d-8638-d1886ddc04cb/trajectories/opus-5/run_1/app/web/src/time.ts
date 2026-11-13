// Reading clock times in the three published zones, always from the server
// clock, never the device's.

export type Wall = { y: number; m: number; d: number; h: number; min: number };

export const ZONES = ["America/New_York", "Europe/London", "Pacific/Auckland"] as const;
export type Zone = (typeof ZONES)[number];

const CITY_BY_ZONE: Record<string, string> = {
  "America/New_York": "New York",
  "Europe/London": "London",
  "Pacific/Auckland": "Auckland",
};

export function cityOf(zone: string): string {
  return CITY_BY_ZONE[zone] ?? zone;
}

export function zoneOfCity(city: string): string {
  return ZONES.find((zone) => CITY_BY_ZONE[zone] === city) ?? "Europe/London";
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    formatters.set(zone, found);
  }
  return found;
}

/** inZone reads an instant as a clock time in a zone. */
export function inZone(instant: number, zone: string): Wall {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { y: value("year"), m: value("month"), d: value("day"), h: value("hour") % 24, min: value("minute") };
}

/** instantOf reads a clock time in a zone as an instant. */
export function instantOf(wall: Wall, zone: string): number {
  const target = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min);
  let guess = target;
  for (let round = 0; round < 3; round += 1) {
    const back = inZone(guess, zone);
    const drift = Date.UTC(back.y, back.m - 1, back.d, back.h, back.min) - target;
    if (drift === 0) break;
    guess -= drift;
  }
  return guess;
}

export function parseLocal(value: string): Wall {
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = (time ?? "00:00").split(":").map(Number);
  return { y, m, d, h: h ?? 0, min: min ?? 0 };
}

export function wallDate(wall: Wall): string {
  return `${pad4(wall.y)}-${pad(wall.m)}-${pad(wall.d)}`;
}

export function wallClock(wall: Wall): string {
  return `${pad(wall.h)}:${pad(wall.min)}`;
}

export function wallLocal(wall: Wall): string {
  return `${wallDate(wall)}T${wallClock(wall)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

export function minutesOfDay(wall: Wall): number {
  return wall.h * 60 + wall.min;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** readableDate writes a date the published way, like Mon 8 Mar 2027. */
export function readableDate(date: string): string {
  const wall = parseLocal(date);
  return `${DAY_NAMES[weekdayOf(date)]} ${wall.d} ${MONTH_NAMES[wall.m - 1]} ${wall.y}`;
}

export function monthName(month: number): string {
  return MONTH_FULL[month - 1];
}

export function weekdayName(index: number): string {
  return WEEKDAY_FULL[index];
}

export function shortDayName(index: number): string {
  return DAY_NAMES[index];
}

/** weekdayOf gives a date's weekday, 0 for Sunday. */
export function weekdayOf(date: string): number {
  const wall = parseLocal(date);
  return new Date(Date.UTC(wall.y, wall.m - 1, wall.d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const wall = parseLocal(date);
  const moved = new Date(Date.UTC(wall.y, wall.m - 1, wall.d) + days * 86400000);
  return `${pad4(moved.getUTCFullYear())}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

export function addMonths(date: string, months: number): string {
  const wall = parseLocal(date);
  const total = wall.y * 12 + (wall.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(wall.d, daysInMonth(y, m));
  return `${pad4(y)}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function daysBetween(from: string, to: string): number {
  const a = parseLocal(from);
  const b = parseLocal(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/** startOfWeek gives the first day of a date's week for a week start. */
export function startOfWeek(date: string, weekStart: string): string {
  const first = weekStart === "sunday" ? 0 : weekStart === "saturday" ? 6 : 1;
  const shift = (weekdayOf(date) - first + 7) % 7;
  return addDays(date, -shift);
}

/** serverClock keeps the one clock every default date and the now line read. */
class ServerClock {
  private offset = 0;
  private known = false;

  async refresh(): Promise<void> {
    const response = await fetch("/api/time", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const body = (await response.json()) as { now_utc: string };
    this.offset = Date.parse(body.now_utc) - Date.now();
    this.known = true;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  ready(): boolean {
    return this.known;
  }
}

export const serverClock = new ServerClock();

/** today gives the date the server clock is on in a zone. */
export function today(zone: string): string {
  return wallDate(inZone(serverClock.now(), zone));
}
