// Kitchen time: every date, wall-clock time and zone abbreviation is computed in the kitchen's
// zone from an instant, never from the zone of the process or browser running this code.

export const KITCHEN_TIME_ZONE = "America/Chicago";
export const MINUTES_PER_DAY = 1440;
export const SLOT_MINUTES = 15;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: KITCHEN_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const zoneFormat = new Intl.DateTimeFormat("en-US", { timeZone: KITCHEN_TIME_ZONE, timeZoneName: "short" });

interface KitchenWallClock {
  date: string;
  minuteOfDay: number;
}

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function fields(instant: number): Fields {
  const found: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found.year ?? 0,
    month: found.month ?? 0,
    day: found.day ?? 0,
    hour: found.hour ?? 0,
    minute: found.minute ?? 0,
    second: found.second ?? 0,
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Year, month and day of a `YYYY-MM-DD` date. */
function dateParts(date: string): { year: number; month: number; day: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

function utcMidnight(date: string): number {
  const { year, month, day } = dateParts(date);
  return Date.UTC(year, month - 1, day);
}

/** The kitchen's UTC offset in minutes at an instant (−300 in CDT, −360 in CST). */
function offsetMinutes(instant: number): number {
  const f = fields(instant);
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return Math.round((wall - (instant - (((instant % 1000) + 1000) % 1000))) / MINUTE_MS);
}

export function wallClockOf(instant: number): KitchenWallClock {
  const f = fields(instant);
  return { date: isoDate(f.year, f.month, f.day), minuteOfDay: f.hour * 60 + f.minute };
}

export function kitchenDateOf(instant: number): string {
  return wallClockOf(instant).date;
}

/**
 * The instant of a kitchen wall-clock time, `minutes` after 00:00 of `date` (1440 is the next
 * midnight). A time inside the skipped spring hour has no instant (null); a time inside the
 * repeated autumn hour means its first occurrence.
 */
export function wallClockInstant(date: string, minutes: number): number | null {
  const wall = utcMidnight(date) + minutes * MINUTE_MS;
  const offsets = new Set([offsetMinutes(wall - DAY_MS / 2), offsetMinutes(wall + DAY_MS / 2)]);
  const instants = [...offsets]
    .map((offset) => wall - offset * MINUTE_MS)
    .filter((instant) => instant + offsetMinutes(instant) * MINUTE_MS === wall);
  return instants.length ? Math.min(...instants) : null;
}

/** The first existing kitchen wall-clock time at or after `minutes` on `date` (a skipped time moves past the gap). */
export function existingWallClockInstant(date: string, minutes: number): number {
  for (let later = minutes; later <= minutes + 120; later += SLOT_MINUTES) {
    const instant = wallClockInstant(date, later);
    if (instant !== null) return instant;
  }
  throw new Error(`no kitchen time near ${date} ${minutes}`);
}

/** Minutes from 00:00 of `date` on the kitchen wall clock to an instant (may be < 0 or > 1440). */
export function wallMinutesFrom(date: string, instant: number): number {
  const clock = wallClockOf(instant);
  return Math.round((utcMidnight(clock.date) - utcMidnight(date)) / MINUTE_MS) + clock.minuteOfDay;
}

export function zoneAbbreviation(instant: number): string {
  return zoneFormat.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** The abbreviation in force at 12:00 on a kitchen date, as the board's day line shows it. */
export function zoneAtNoon(date: string): string {
  return zoneAbbreviation(wallClockInstant(date, 12 * 60) ?? utcMidnight(date));
}

export function addDays(date: string, days: number): string {
  const moved = new Date(utcMidnight(date) + days * DAY_MS);
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function weekdayName(date: string): string {
  return WEEKDAYS[new Date(utcMidnight(date)).getUTCDay()] ?? "";
}

/** `Saturday 7 November 2026` */
export function longDate(date: string): string {
  const moved = new Date(utcMidnight(date));
  return `${weekdayName(date)} ${moved.getUTCDate()} ${MONTHS[moved.getUTCMonth()] ?? ""} ${moved.getUTCFullYear()}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = dateParts(value);
  const moved = new Date(Date.UTC(year, month - 1, day));
  return moved.getUTCFullYear() === year && moved.getUTCMonth() + 1 === month && moved.getUTCDate() === day;
}

/** `HH:MM` for minutes after midnight; 1440 reads `24:00`. */
export function formatHHMM(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Parses an `HH:MM` on a 15-minute mark between 00:00 and 24:00. */
export function parseHHMM(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) % SLOT_MINUTES !== 0 || Number(match[2]) >= 60 || minutes > MINUTES_PER_DAY) return null;
  return minutes;
}

/** Minutes after midnight of an `HH:MM` the server reported (already validated). */
export function clockMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** The kitchen wall-clock `HH:MM` of an instant. */
export function clockTimeOf(instant: number): string {
  return formatHHMM(wallClockOf(instant).minuteOfDay);
}

/** `2026-11-07 14:30 CST` */
export function formatKitchenDateTime(instant: number): string {
  return `${kitchenDateOf(instant)} ${clockTimeOf(instant)} ${zoneAbbreviation(instant)}`;
}

export function kitchenMonthOf(instant: number): string {
  return kitchenDateOf(instant).slice(0, 7);
}
