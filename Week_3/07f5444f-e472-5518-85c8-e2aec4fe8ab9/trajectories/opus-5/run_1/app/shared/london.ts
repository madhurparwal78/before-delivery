export const BUSINESS_ZONE = 'Europe/London';

const DAY_MS = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

interface ZonedParts extends WallClock {
  second: number;
}

const zoneFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function londonParts(ms: number): ZonedParts {
  const read: Record<string, string> = {};
  for (const part of zoneFormat.formatToParts(new Date(ms))) read[part.type] = part.value;
  return {
    year: Number(read.year),
    month: Number(read.month),
    day: Number(read.day),
    hour: Number(read.hour),
    minute: Number(read.minute),
    second: Number(read.second),
  };
}

export function londonOffsetMs(ms: number): number {
  const parts = londonParts(ms);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Converts a London wall-clock time to an instant. A time that occurs twice (the hour the
 * clocks go back) takes the earlier instant; a time that does not occur returns null.
 */
export function wallClockToInstantMs(wall: WallClock): number | null {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const candidates: number[] = [];
  for (const probe of [naive - DAY_MS, naive + DAY_MS]) {
    const candidate = naive - londonOffsetMs(probe);
    if (candidates.includes(candidate)) continue;
    const back = londonParts(candidate);
    if (
      back.year === wall.year &&
      back.month === wall.month &&
      back.day === wall.day &&
      back.hour === wall.hour &&
      back.minute === wall.minute
    ) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function offsetLabel(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const total = Math.abs(Math.round(offsetMs / 60_000));
  return `${sign}${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** ISO 8601 for an instant, written with London's offset for that instant. */
export function isoWithLondonOffset(ms: number): string {
  const parts = londonParts(ms);
  return (
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` +
    `T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}` +
    offsetLabel(londonOffsetMs(ms))
  );
}

/** The business-zone calendar date (YYYY-MM-DD) of an instant. */
export function businessDateOf(ms: number): string {
  const parts = londonParts(ms);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function addDaysToBusinessDate(date: string, days: number): string {
  const [year, month, day] = splitDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function compareBusinessDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `Sat 14 Nov 2026` for a business-zone date. */
export function displayBusinessDate(date: string): string {
  const [year, month, day] = splitDate(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** `Tue 1 Dec 2026, 10:00` for a timestamp already written with London's offset. */
export function displayInstant(iso: string): string {
  const fields = isoFields(iso);
  return `${displayBusinessDate(`${fields.year}-${pad2(fields.month)}-${pad2(fields.day)}`)}, ${pad2(fields.hour)}:${pad2(fields.minute)}`;
}

/** The business-zone date part of a timestamp already written with London's offset. */
export function instantBusinessDate(iso: string): string {
  const fields = isoFields(iso);
  return `${fields.year}-${pad2(fields.month)}-${pad2(fields.day)}`;
}

export function isoFields(iso: string): WallClock {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!match) throw new Error(`not an ISO timestamp: ${iso}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function splitDate(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`not a business-zone date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
