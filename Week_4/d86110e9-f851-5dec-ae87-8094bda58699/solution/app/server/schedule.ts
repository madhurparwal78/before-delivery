import { config } from './config.js';

type Schedule = { kind: 'every'; minutes: number } | { kind: 'daily'; hour: number; minute: number };

const MINUTE = 60_000;
const DAY = 86_400_000;

export function parseSchedule(text: string): Schedule | null {
  const value = text.trim();
  const every = /^every (\d+) minutes$/.exec(value);
  if (every) {
    const minutes = Number(every[1]);
    return minutes >= 1 && minutes <= 1440 ? { kind: 'every', minutes } : null;
  }
  const daily = /^daily at (\d{2}):(\d{2})$/.exec(value);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    return hour <= 23 && minute <= 59 ? { kind: 'daily', hour, minute } : null;
  }
  return null;
}

const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallAt(ms: number): Wall {
  const parts = Object.fromEntries(zoneParts.formatToParts(new Date(ms)).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0, hour: parts.hour ?? 0, minute: parts.minute ?? 0 };
}

function offsetAt(ms: number): number {
  const wall = wallAt(ms);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - Math.floor(ms / MINUTE) * MINUTE;
}

/** The instant a local date and time falls on: the first occurrence when repeated, the first existing minute when skipped. */
function occurrenceOn(date: Date, hour: number, minute: number): number {
  const asUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  const before = offsetAt(asUtc - DAY);
  const after = offsetAt(asUtc + DAY);
  const matches = [...new Set([before, after])]
    .map((offset) => asUtc - offset)
    .filter((instant) => {
      const wall = wallAt(instant);
      return wall.day === date.getUTCDate() && wall.hour === hour && wall.minute === minute;
    });
  if (matches.length > 0) return Math.min(...matches);
  let low = asUtc - DAY;
  let high = asUtc + DAY;
  while (high - low > MINUTE) {
    const middle = low + Math.floor((high - low) / MINUTE / 2) * MINUTE;
    if (offsetAt(middle) === before) low = middle;
    else high = middle;
  }
  return high;
}

function dailyAfter(after: number, hour: number, minute: number): number {
  const wall = wallAt(after);
  for (let offset = 0; ; offset += 1) {
    const instant = occurrenceOn(new Date(Date.UTC(wall.year, wall.month - 1, wall.day + offset)), hour, minute);
    if (instant > after) return instant;
  }
}

/** First firing of a schedule published at `publishedAt`. */
export function firstFiring(schedule: Schedule, publishedAt: number): number {
  return schedule.kind === 'every' ? publishedAt + schedule.minutes * MINUTE : dailyAfter(publishedAt, schedule.hour, schedule.minute);
}

/** The firing that follows a scheduled instant. */
export function followingFiring(schedule: Schedule, previous: number): number {
  return schedule.kind === 'every' ? previous + schedule.minutes * MINUTE : dailyAfter(previous, schedule.hour, schedule.minute);
}
