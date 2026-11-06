export const TORONTO = 'America/Toronto';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TORONTO,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function torontoParts(at: Date): WallClock {
  const parts = partsFormatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Minutes east of UTC for Toronto at the given instant (negative). */
export function torontoOffsetMinutes(at: Date): number {
  const wall = torontoParts(at);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Converts a Toronto wall-clock time to an instant. A time inside the spring-forward gap moves
 * forward one hour; a time inside the fall-back hour takes the first, daylight-time occurrence.
 */
export function instantFromToronto(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const candidates = [
    torontoOffsetMinutes(new Date(naive - 86400000)),
    torontoOffsetMinutes(new Date(naive + 86400000)),
  ].sort((a, b) => b - a);
  for (const offset of candidates) {
    const instant = new Date(naive - offset * 60000);
    const wall = torontoParts(instant);
    if (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour === hour &&
      wall.minute === minute
    ) {
      return instant;
    }
  }
  return instantFromToronto(year, month, day, hour + 1, minute);
}

export function instantFromLocalString(local: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local);
  if (match === null) throw new Error(`Not a local date-time: ${local}`);
  return instantFromToronto(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

export function instantFromDateAt(date: string, hour: number, minute: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new Error(`Not a date: ${date}`);
  return instantFromToronto(Number(match[1]), Number(match[2]), Number(match[3]), hour, minute);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function torontoDate(at: Date): string {
  const wall = torontoParts(at);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function torontoTime(at: Date): string {
  const wall = torontoParts(at);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

export function torontoLocal(at: Date): string {
  return `${torontoDate(at)}T${torontoTime(at)}`;
}

export function toIso(at: Date): string {
  const wall = torontoParts(at);
  const offset = torontoOffsetMinutes(at);
  const sign = offset <= 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function toIsoMillis(at: Date): string {
  const wall = torontoParts(at);
  const offset = torontoOffsetMinutes(at);
  const sign = offset <= 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `.${pad(at.getMilliseconds(), 3)}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function addCalendarDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new Error(`Not a date: ${date}`);
  const moved = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() + 1 === month && probe.getUTCDate() === day;
}

export function isLocalDateTimeString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(:\d{2})?$/.exec(value);
  if (match === null) return false;
  return isDateString(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60;
}
