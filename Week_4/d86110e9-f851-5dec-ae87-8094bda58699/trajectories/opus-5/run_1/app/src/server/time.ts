import { config } from './config';
import { one, query } from './db';

/** The only place the machine clock is read. */
function machineNow(): number {
  return Date.now();
}

const MINUTE_MS = 60_000;

async function offsetSeconds(workspaceId: string): Promise<number> {
  const row = await one<{ clock_offset_seconds: string }>(
    'select clock_offset_seconds from workspaces where id = $1',
    [workspaceId],
  );
  return row ? Number(row.clock_offset_seconds) : 0;
}

/** The workspace clock: real time plus the workspace's stored offset. */
export async function workspaceNow(workspaceId: string): Promise<Date> {
  return new Date(machineNow() + (await offsetSeconds(workspaceId)) * 1000);
}

export async function setWorkspaceOffset(workspaceId: string, seconds: number): Promise<void> {
  await query('update workspaces set clock_offset_seconds = $2 where id = $1', [workspaceId, Math.round(seconds)]);
}

export function iso(date: Date): string {
  return date.toISOString();
}

export function plusSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function wallClockOf(date: Date): WallClock & { second: number } {
  const parts = partsFormatter.formatToParts(date);
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function zoneOffsetMs(date: Date): number {
  const wall = wallClockOf(date);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, 0);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function sameWallClock(date: Date, wall: WallClock): boolean {
  const actual = wallClockOf(date);
  return (
    actual.year === wall.year &&
    actual.month === wall.month &&
    actual.day === wall.day &&
    actual.hour === wall.hour &&
    actual.minute === wall.minute
  );
}

/** The instant a zone transition happens inside the hour around the given guess. */
function transitionInstant(from: Date, to: Date): Date {
  let low = from.getTime();
  let high = to.getTime();
  const startOffset = zoneOffsetMs(new Date(low));
  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS;
    if (middle === low) break;
    if (zoneOffsetMs(new Date(middle)) === startOffset) low = middle;
    else high = middle;
  }
  return new Date(high);
}

/**
 * The instant of a wall-clock time in the workspace zone. A time that does not exist
 * resolves to the first existing minute after the skipped hour; a repeated time resolves
 * to its first occurrence.
 */
export function instantOfWallClock(wall: WallClock): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  const guesses = [naive - zoneOffsetMs(new Date(naive - 12 * 3600_000)), naive - zoneOffsetMs(new Date(naive + 12 * 3600_000))];
  const valid = [...new Set(guesses)]
    .map((value) => new Date(value))
    .filter((candidate) => sameWallClock(candidate, wall))
    .sort((a, b) => a.getTime() - b.getTime());
  if (valid.length > 0) return valid[0];
  const dayStart = new Date(Math.min(...guesses) - 6 * 3600_000);
  const dayEnd = new Date(Math.max(...guesses) + 6 * 3600_000);
  return transitionInstant(dayStart, dayEnd);
}

export function startOfZoneDayAfter(date: Date): WallClock {
  const wall = wallClockOf(date);
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + 36 * 3600_000);
  const nextWall = wallClockOf(next);
  return { year: nextWall.year, month: nextWall.month, day: nextWall.day, hour: 0, minute: 0 };
}
