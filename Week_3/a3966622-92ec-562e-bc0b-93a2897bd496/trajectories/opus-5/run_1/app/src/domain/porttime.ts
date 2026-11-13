export const PORT_ZONE = 'America/Halifax';
export const STEP_MINUTES = 5;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

export type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: PORT_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function instantToWall(instant: number): Wall {
  const found: Record<string, string> = {};
  for (const part of parts.formatToParts(instant)) found[part.type] = part.value;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

function wallAsUtc(wall: Wall): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Minutes to add to UTC to get port time at this instant: -180 in daylight time, -240 in standard time. */
export function offsetMinutesAt(instant: number): number {
  const second = Math.floor(instant / 1000) * 1000;
  return (wallAsUtc(instantToWall(second)) - second) / MINUTE_MS;
}

export function offsetLabel(instant: number): string {
  const minutes = offsetMinutesAt(instant);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** ADT in daylight time, AST in standard time. */
export function zoneAbbreviation(instant: number): string {
  return offsetMinutesAt(instant) === -180 ? 'ADT' : 'AST';
}

/** Every instant whose port-local wall-clock reading is this wall time, earliest first. */
export function wallToInstants(wall: Wall): number[] {
  const asUtc = wallAsUtc(wall);
  const candidates = new Set([
    offsetMinutesAt(asUtc - 24 * HOUR_MS),
    offsetMinutesAt(asUtc + 24 * HOUR_MS),
  ]);
  const instants: number[] = [];
  for (const offset of candidates) {
    const instant = asUtc - offset * MINUTE_MS;
    if (offsetMinutesAt(instant) === offset) instants.push(instant);
  }
  return instants.sort((a, b) => a - b);
}

/** A repeated local time means its first occurrence; a skipped local time has no instant. */
export function wallToInstant(wall: Wall): number | null {
  const instants = wallToInstants(wall);
  return instants.length === 0 ? null : (instants[0] as number);
}

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateKeyOf(wall: Wall): string {
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function dateKeyAt(instant: number): string {
  return dateKeyOf(instantToWall(instant));
}

export function timeOf(wall: Wall): string {
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

export function formatWallMinutes(wall: Wall): string {
  return `${dateKeyOf(wall)}T${timeOf(wall)}`;
}

export function formatWallSeconds(wall: Wall): string {
  return `${dateKeyOf(wall)}T${timeOf(wall)}:${pad(wall.second)}`;
}

export function formatInstantMinutes(instant: number): string {
  return formatWallMinutes(instantToWall(instant));
}

export function formatInstantSeconds(instant: number): string {
  return formatWallSeconds(instantToWall(instant));
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function validWall(wall: Wall): Wall | null {
  const asUtc = wallAsUtc(wall);
  const back = new Date(asUtc);
  if (
    back.getUTCFullYear() !== wall.year ||
    back.getUTCMonth() + 1 !== wall.month ||
    back.getUTCDate() !== wall.day ||
    back.getUTCHours() !== wall.hour ||
    back.getUTCMinutes() !== wall.minute ||
    back.getUTCSeconds() !== wall.second
  ) {
    return null;
  }
  return wall;
}

export function parsePortDate(text: string): Wall | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  return validWall({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

export function parsePortDateTime(text: string): Wall | null {
  const match = DATE_TIME_PATTERN.exec(text);
  if (!match) return null;
  return validWall({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
  });
}

export function parsePortTime(text: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function wallOnDate(date: Wall, minutesAfterMidnight: number): Wall {
  return {
    year: date.year,
    month: date.month,
    day: date.day,
    hour: Math.floor(minutesAfterMidnight / 60),
    minute: minutesAfterMidnight % 60,
    second: 0,
  };
}

/** Minutes after port midnight, wall-clock, of every 5-minute step that exists on this date. */
export function existingSteps(date: Wall): number[] {
  const steps: number[] = [];
  for (let minutes = 0; minutes <= 1435; minutes += STEP_MINUTES) {
    if (wallToInstants(wallOnDate(date, minutes)).length > 0) steps.push(minutes);
  }
  return steps;
}

export function minutesAfterMidnight(wall: Wall): number {
  return wall.hour * 60 + wall.minute;
}

export function shiftDate(date: Wall, days: number): Wall {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = parsePortDate(dateKey);
  if (date === null) throw new Error(`not a port date key: ${dateKey}`);
  return dateKeyOf(shiftDate(date, days));
}

export function startOfPortDate(date: Wall): number {
  for (let minutes = 0; minutes <= 1435; minutes += 1) {
    const instant = wallToInstant(wallOnDate(date, minutes));
    if (instant !== null) return instant;
  }
  throw new Error(`no instant on port date ${dateKeyOf(date)}`);
}
