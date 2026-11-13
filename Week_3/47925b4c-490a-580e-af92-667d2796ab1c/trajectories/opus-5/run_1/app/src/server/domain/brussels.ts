export const BRUSSELS = 'Europe/Brussels';

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: BRUSSELS,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function wallClockAt(instant: number): WallClock & { readonly second: number } {
  const found = new Map<string, string>();
  for (const part of parts.formatToParts(instant)) found.set(part.type, part.value);
  const hour = Number(found.get('hour'));
  return {
    year: Number(found.get('year')),
    month: Number(found.get('month')),
    day: Number(found.get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(found.get('minute')),
    second: Number(found.get('second')),
  };
}

function offsetMinutesAt(instant: number): number {
  const clock = wallClockAt(instant);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return (asUtc - Math.floor(instant / 1000) * 1000) / 60000;
}

function firstInstantOfNewOffset(low: number, high: number): number {
  let before = low;
  let after = high;
  const target = offsetMinutesAt(high);
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2);
    if (offsetMinutesAt(middle) === target) after = middle;
    else before = middle;
  }
  return after;
}

/**
 * The instant for a Brussels wall-clock reading. A gap resolves to the first
 * valid instant after it; a fold resolves to the earlier offset.
 */
export function brusselsWallClockToInstant(clock: WallClock): number {
  const naive = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  const candidates = new Set([offsetMinutesAt(naive - 86_400_000), offsetMinutesAt(naive + 86_400_000)]);
  const valid: number[] = [];
  for (const offset of candidates) {
    const instant = naive - offset * 60_000;
    const back = wallClockAt(instant);
    if (
      back.year === clock.year &&
      back.month === clock.month &&
      back.day === clock.day &&
      back.hour === clock.hour &&
      back.minute === clock.minute
    ) {
      valid.push(instant);
    }
  }
  if (valid.length > 0) return Math.min(...valid);
  return firstInstantOfNewOffset(naive - 86_400_000, naive + 86_400_000);
}

export function parseLocalShowTime(text: string): number | null {
  const found = LOCAL.exec(text);
  if (found === null) return null;
  const [, year, month, day, hour, minute] = found;
  const clock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  if (clock.hour > 23 || clock.minute > 59) return null;
  if (!isValidDay(`${year}-${month}-${day}`)) return null;
  return brusselsWallClockToInstant(clock);
}

export function brusselsWallClockText(instant: number): string {
  const clock = wallClockAt(instant);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}`;
}

export function brusselsToday(instant: number): string {
  const clock = wallClockAt(instant);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

export function isValidDay(text: string): boolean {
  const found = DAY.exec(text);
  if (found === null) return false;
  const [, year, month, day] = found;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day);
}
