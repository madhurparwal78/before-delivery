/**
 * Kitchen time. Every date, month boundary, cutoff and label in Lineboard is
 * computed against the kitchen's IANA zone, never the server's or browser's.
 */
import { addDays, minutesOfDay, pad2, parseDate, timeFromMinutes } from '../../shared/calendar.js';

export type LocalWall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatterCache.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(zone, found);
  }
  return found;
}

function wallAt(zone: string, instantMs: number): LocalWall & { second: number } {
  const parts = formatter(zone).formatToParts(new Date(instantMs));
  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number.parseInt(part.value, 10) : 0;
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

/** Minutes east of UTC for the zone at an instant. */
export function offsetMinutes(zone: string, instantMs: number): number {
  const wall = wallAt(zone, instantMs);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

export type WallResolution = { kind: 'ok'; instantMs: number } | { kind: 'gap' };

/**
 * Resolve a kitchen wall time to one instant. A time inside a spring-forward
 * gap does not exist; a repeated fall-back time means its first occurrence.
 */
export function wallToInstant(zone: string, wall: LocalWall): WallResolution {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const candidates = new Set<number>();
  for (const probe of [naive - 86400000, naive + 86400000]) {
    candidates.add(naive - offsetMinutes(zone, probe) * 60000);
  }
  const valid: number[] = [];
  for (const candidate of candidates) {
    const back = wallAt(zone, candidate);
    if (
      back.year === wall.year &&
      back.month === wall.month &&
      back.day === wall.day &&
      back.hour === wall.hour &&
      back.minute === wall.minute
    ) {
      valid.push(candidate);
    }
  }
  if (valid.length === 0) return { kind: 'gap' };
  return { kind: 'ok', instantMs: Math.min(...valid) };
}

/** Local date (YYYY-MM-DD) of an instant in the kitchen's zone. */
export function localDateOf(zone: string, instantMs: number): string {
  const wall = wallAt(zone, instantMs);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

/** Local time (HH:MM) of an instant in the kitchen's zone. */
export function localTimeOf(zone: string, instantMs: number): string {
  const wall = wallAt(zone, instantMs);
  return `${pad2(wall.hour)}:${pad2(wall.minute)}`;
}

export function localMonthOf(zone: string, instantMs: number): string {
  return localDateOf(zone, instantMs).slice(0, 7);
}

/** ISO 8601 with the kitchen's offset in force at that instant. */
export function formatInstant(zone: string, instantMs: number): string {
  const wall = wallAt(zone, instantMs);
  return (
    `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}` +
    `T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}` +
    formatOffset(offsetMinutes(zone, instantMs))
  );
}

/**
 * The instant of a kitchen-local date and time, where "24:00" means the start
 * of the next date. Returns null when the wall time does not exist.
 */
export function localToInstant(zone: string, date: string, time: string): number | null {
  const minutes = minutesOfDay(time);
  const targetDate = minutes >= 1440 ? addDays(date, 1) : date;
  const targetMinutes = minutes >= 1440 ? minutes - 1440 : minutes;
  const parsed = parseDate(targetDate);
  if (!parsed) return null;
  const resolved = wallToInstant(zone, {
    year: parsed.year,
    month: parsed.month,
    day: parsed.day,
    hour: Math.floor(targetMinutes / 60),
    minute: targetMinutes % 60,
  });
  return resolved.kind === 'ok' ? resolved.instantMs : null;
}

/** Start of a kitchen-local day, skipping forward over a gap at midnight. */
export function dayStartInstant(zone: string, date: string): number {
  for (let minute = 0; minute < 1440; minute += 15) {
    const candidate = localToInstant(zone, date, timeFromMinutes(minute));
    if (candidate !== null) return candidate;
  }
  throw new Error(`No start of day for ${date}`);
}

export function monthStartInstant(zone: string, month: string): number {
  return dayStartInstant(zone, `${month}-01`);
}

export function parseEffectiveFrom(text: unknown): LocalWall | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const date = parseDate(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number.parseInt(match[4]!, 10);
  const minute = Number.parseInt(match[5]!, 10);
  if (hour > 23 || minute > 59) return null;
  return { year: date.year, month: date.month, day: date.day, hour, minute };
}

export function wallDate(wall: LocalWall): string {
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

export function wallTime(wall: LocalWall): string {
  return `${pad2(wall.hour)}:${pad2(wall.minute)}`;
}
