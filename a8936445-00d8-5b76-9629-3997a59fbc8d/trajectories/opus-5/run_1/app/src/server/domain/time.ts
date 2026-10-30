import { KITCHEN } from './constants.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KITCHEN.timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KITCHEN.timeZone,
  timeZoneName: 'longOffset',
});

export interface KitchenWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClockAt(instant: Date): KitchenWallClock {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number.parseInt(part ? part.value : '0', 10);
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

/** Offset of the kitchen zone at an instant, in milliseconds east of UTC (negative for Chicago). */
export function offsetMsAt(instant: Date): number {
  const name = offsetFormatter
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName');
  const text = name ? name.value : 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(text);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number.parseInt(match[2]!, 10) * 60 + Number.parseInt(match[3]!, 10)) * MINUTE_MS;
}

export function offsetLabelAt(instant: Date): string {
  const offset = offsetMsAt(instant);
  const sign = offset < 0 ? '-' : '+';
  const total = Math.abs(offset) / MINUTE_MS;
  return `${sign}${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Resolves a kitchen wall-clock date and minute-of-day to UTC instants. */
export interface LocalResolution {
  instant: Date | null;
  skipped: boolean;
}

export function resolveLocal(date: string, minuteOfDay: number): LocalResolution {
  const [year, month, day] = splitDate(date);
  const extraDays = Math.floor(minuteOfDay / 1440);
  const minuteInDay = minuteOfDay - extraDays * 1440;
  const naive =
    Date.UTC(year, month - 1, day + extraDays, Math.floor(minuteInDay / 60), minuteInDay % 60, 0, 0);
  const before = offsetMsAt(new Date(naive - DAY_MS));
  const after = offsetMsAt(new Date(naive + DAY_MS));
  const candidates = before === after ? [naive - before] : [naive - before, naive - after];
  const valid = candidates
    .filter((candidate) => localMinutesOf(new Date(candidate), naive))
    .sort((a, b) => a - b);
  const first = valid[0];
  if (first === undefined) return { instant: null, skipped: true };
  return { instant: new Date(first), skipped: false };
}

function localMinutesOf(instant: Date, naiveUtc: number): boolean {
  const wall = wallClockAt(instant);
  const asNaive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  return asNaive === naiveUtc;
}

/** Resolves a wall-clock time, pushing non-existent local times forward to the transition instant. */
export function resolveLocalOrTransition(date: string, minuteOfDay: number): Date {
  const direct = resolveLocal(date, minuteOfDay);
  if (direct.instant) return direct.instant;
  for (let probe = minuteOfDay + 1; probe <= minuteOfDay + 180; probe += 1) {
    const next = resolveLocal(date, probe);
    if (next.instant) return next.instant;
  }
  throw new Error(`Unresolvable kitchen time ${date} ${minuteOfDay}`);
}

export function splitDate(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid kitchen date ${date}`);
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
  ];
}

export function kitchenDateOf(instant: Date): string {
  const wall = wallClockAt(instant);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

export function kitchenMinuteOf(instant: Date): number {
  const wall = wallClockAt(instant);
  return wall.hour * 60 + wall.minute;
}

export function kitchenToday(now: Date = new Date()): string {
  return kitchenDateOf(now);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = splitDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = splitDate(from);
  const [ty, tm, td] = splitDate(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = splitDate(date);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

export function parseLocalTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number.parseInt(match[1]!, 10);
  const minute = Number.parseInt(match[2]!, 10);
  if (minute > 59) return null;
  const total = hour * 60 + minute;
  if (total < 0 || total > 1440) return null;
  if (total === 1440) return 1440;
  if (hour > 23) return null;
  return total;
}

/** ISO 8601 with seconds and the kitchen offset at that instant. */
export function toKitchenIso(instant: Date): string {
  const wall = wallClockAt(instant);
  return (
    `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}` +
    `T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}${offsetLabelAt(instant)}`
  );
}

export interface DayTransitions {
  skipped: [number, number] | null;
  repeated: [number, number] | null;
}

/** Wall-clock minute ranges of a DST change on a kitchen date. */
export function transitionsOn(date: string): DayTransitions {
  const dayStart = resolveLocalOrTransition(date, 0);
  const nextStart = resolveLocalOrTransition(addDays(date, 1), 0);
  const realMinutes = Math.round((nextStart.getTime() - dayStart.getTime()) / MINUTE_MS);
  if (realMinutes === 1440) return { skipped: null, repeated: null };
  if (realMinutes < 1440) {
    const gap = 1440 - realMinutes;
    for (let minute = 0; minute < 1440; minute += 1) {
      if (resolveLocal(date, minute).instant === null) {
        return { skipped: [minute, minute + gap], repeated: null };
      }
    }
    return { skipped: null, repeated: null };
  }
  const overlap = realMinutes - 1440;
  for (let minute = 0; minute < 1440; minute += 1) {
    const naive = naiveUtcOf(date, minute);
    const before = offsetMsAt(new Date(naive - DAY_MS));
    const after = offsetMsAt(new Date(naive + DAY_MS));
    if (before === after) continue;
    const first = new Date(naive - before);
    const second = new Date(naive - after);
    if (localMinutesOf(first, naive) && localMinutesOf(second, naive)) {
      return { skipped: null, repeated: [minute, minute + overlap] };
    }
  }
  return { skipped: null, repeated: null };
}

function naiveUtcOf(date: string, minuteOfDay: number): number {
  const [year, month, day] = splitDate(date);
  return Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
}

export function monthPeriodOf(date: string): string {
  return date.slice(0, 7);
}

export function periodBounds(period: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid period ${period}`);
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const firstDay = `${year}-${pad2(month)}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return {
    start: resolveLocalOrTransition(firstDay, 0),
    end: resolveLocalOrTransition(nextMonth, 0),
  };
}

export function isValidPeriod(period: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return false;
  const month = Number.parseInt(match[2]!, 10);
  return month >= 1 && month <= 12;
}

export function currentStepMinute(now: Date = new Date()): number {
  return Math.floor(kitchenMinuteOf(now) / 15) * 15;
}
