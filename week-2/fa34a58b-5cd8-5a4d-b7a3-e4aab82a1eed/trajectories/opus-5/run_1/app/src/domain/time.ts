/**
 * The household zone and the household day are decided here and nowhere else.
 * Every schedule time, slot occurrence, day boundary and "today" in the system
 * passes through this module.
 */

export const HOUSEHOLD_ZONE = 'America/Chicago';

export type HouseholdDay = string; // YYYY-MM-DD
export type WallTime = string; // HH:MM

export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HOUSEHOLD_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function wallPartsOf(instant: Date): WallParts {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Missing date part ${type}`);
    return Number(found.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of the household zone at an instant, in minutes (e.g. -300 for CDT). */
export function offsetMinutesAt(instant: Date): number {
  const parts = wallPartsOf(instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

export function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** CDT at minus five hours, CST at minus six. */
export function abbrOf(offsetMinutes: number): string {
  return offsetMinutes === -300 ? 'CDT' : 'CST';
}

export function abbrAt(instant: Date): string {
  return abbrOf(offsetMinutesAt(instant));
}

export function offsetLabelAt(instant: Date): string {
  return offsetLabel(offsetMinutesAt(instant));
}

/** All instants that show the given household wall time: 0 (skipped), 1 or 2 (repeated). */
export function wallToInstants(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date[] {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidates = new Set<number>();
  for (const probe of [asUtc - 14 * 3600_000, asUtc + 14 * 3600_000]) {
    candidates.add(asUtc - offsetMinutesAt(new Date(probe)) * 60000);
  }
  const matches: number[] = [];
  for (const candidate of candidates) {
    const parts = wallPartsOf(new Date(candidate));
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === second
    ) {
      matches.push(candidate);
    }
  }
  return matches.sort((a, b) => a - b).map((ms) => new Date(ms));
}

export function parseDay(day: HouseholdDay): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Not a household day: ${day}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const { year, month, day: dayOfMonth } = parseDay(day);
  const probe = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === dayOfMonth
  );
}

export function dayOfParts(parts: { year: number; month: number; day: number }): HouseholdDay {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** The household day containing an instant. */
export function householdDayOf(instant: Date): HouseholdDay {
  return dayOfParts(wallPartsOf(instant));
}

export function addDays(day: HouseholdDay, count: number): HouseholdDay {
  const { year, month, day: dayOfMonth } = parseDay(day);
  const shifted = new Date(Date.UTC(year, month - 1, dayOfMonth + count));
  return dayOfParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** 0 = Sunday. */
export function weekdayIndexOf(day: HouseholdDay): number {
  const { year, month, day: dayOfMonth } = parseDay(day);
  return new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
}

export function longDate(day: HouseholdDay): string {
  const { year, month, day: dayOfMonth } = parseDay(day);
  return `${WEEKDAY_NAMES[weekdayIndexOf(day)]} ${dayOfMonth} ${MONTH_NAMES[month - 1]} ${year}`;
}

export function shortWeekday(day: HouseholdDay): string {
  return (WEEKDAY_NAMES[weekdayIndexOf(day)] as string).slice(0, 3);
}

/** The instant of the household day's opening midnight. */
export function dayStart(day: HouseholdDay): Date {
  const { year, month, day: dayOfMonth } = parseDay(day);
  const first = wallToInstants(year, month, dayOfMonth, 0, 0)[0];
  if (!first) throw new Error(`No midnight on ${day}`);
  return first;
}

export function dayEnd(day: HouseholdDay): Date {
  return dayStart(addDays(day, 1));
}

/** 1440 on an ordinary day, 1500 on the fall-back day, 1380 on the spring-forward day. */
export function dayLengthMinutes(day: HouseholdDay): number {
  return Math.round((dayEnd(day).getTime() - dayStart(day).getTime()) / 60000);
}

export function dayHours(day: HouseholdDay): number {
  return dayLengthMinutes(day) / 60;
}

export function instantFromElapsed(day: HouseholdDay, minutes: number): Date {
  return new Date(dayStart(day).getTime() + minutes * 60000);
}

export interface HourMark {
  at: string;
  label: string;
  abbr: string;
}

/** One mark per elapsed hour of the household day; the repeated hour appears twice. */
export function hourMarks(day: HouseholdDay): HourMark[] {
  const marks: HourMark[] = [];
  const total = dayLengthMinutes(day);
  for (let minute = 0; minute < total; minute += 60) {
    const instant = instantFromElapsed(day, minute);
    marks.push({
      at: formatInstant(instant),
      label: pad2(wallPartsOf(instant).hour),
      abbr: abbrAt(instant),
    });
  }
  return marks;
}

export function isValidWallTime(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

export function parseWallTime(time: WallTime): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Not a wall time: ${time}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export interface SlotOccurrence {
  /** The instant the slot runs. */
  at: Date;
  /** The slot's own wall time, which differs from the local time of `at` on a spring-forward day. */
  slotTime: WallTime;
}

/**
 * The slot occurrence rule across daylight-saving changes.
 * A wall time inside the repeated hour occurs once, at its first pass.
 * A wall time inside the skipped hour occurs at 03:00.
 */
export function slotOccurrence(day: HouseholdDay, time: WallTime): SlotOccurrence {
  const { year, month, day: dayOfMonth } = parseDay(day);
  const { hour, minute } = parseWallTime(time);
  const direct = wallToInstants(year, month, dayOfMonth, hour, minute)[0];
  if (direct) return { at: direct, slotTime: time };
  const atThree = wallToInstants(year, month, dayOfMonth, 3, 0)[0];
  if (!atThree) throw new Error(`No 03:00 on ${day}`);
  return { at: atThree, slotTime: time };
}

/**
 * Resolve a household wall time to an instant for guest scenes.
 * The repeated hour resolves to its first pass; the skipped hour has no instant.
 */
export function resolveWallInstant(day: HouseholdDay, time: WallTime): Date | null {
  const { year, month, day: dayOfMonth } = parseDay(day);
  const { hour, minute } = parseWallTime(time);
  return wallToInstants(year, month, dayOfMonth, hour, minute)[0] ?? null;
}

/** ISO-8601 with seconds and the household offset. */
export function formatInstant(instant: Date): string {
  const parts = wallPartsOf(instant);
  return (
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` +
    `T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}` +
    offsetLabel(offsetMinutesAt(instant))
  );
}

/** Local household wall clock without an offset, e.g. 2027-03-14T03:00:00. */
export function formatLocalWall(instant: Date): string {
  const parts = wallPartsOf(instant);
  return (
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` +
    `T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`
  );
}

export function formatHhMm(instant: Date): string {
  const parts = wallPartsOf(instant);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatHhMmSs(instant: Date): string {
  const parts = wallPartsOf(instant);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

export function isValidInstantText(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/.test(text);
}

/** Parse an offset-bearing ISO instant. */
export function parseInstantText(text: string): Date | null {
  if (!isValidInstantText(text)) return null;
  const value = new Date(text);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** Parse a household wall date-and-time, "YYYY-MM-DDTHH:MM", to the minute. */
export function parseWallDateTime(text: string): { day: HouseholdDay; time: WallTime } | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text);
  if (!match) return null;
  const day = match[1] as string;
  const time = match[2] as string;
  if (!isValidDay(day) || !isValidWallTime(time)) return null;
  return { day, time };
}
