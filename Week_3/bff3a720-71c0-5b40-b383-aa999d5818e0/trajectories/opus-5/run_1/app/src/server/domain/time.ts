export const ZONE = 'Europe/Brussels';

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(at: Date): ZonedParts {
  const found: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(at)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  const hour = Number(found.hour);
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

/** Minutes that Europe/Brussels is ahead of UTC at the given instant. */
export function offsetMinutes(at: Date): number {
  const p = zonedParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Build the instant for a wall-clock time in Europe/Brussels. */
export function fromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(naive - 60 * 60000);
  for (let i = 0; i < 3; i += 1) {
    const candidate = new Date(naive - offsetMinutes(guess) * 60000);
    if (candidate.getTime() === guess.getTime()) return candidate;
    guess = candidate;
  }
  return guess;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** ISO 8601 with the Europe/Brussels offset, for example 2026-11-13T08:30:00+01:00. */
export function isoZoned(at: Date): string {
  const p = zonedParts(at);
  const offset = offsetMinutes(at);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Calendar date in the network zone, as YYYY-MM-DD. */
export function zonedDate(at: Date): string {
  const p = zonedParts(at);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Wall-clock time in the network zone, as HH:MM. */
export function zonedTime(at: Date): string {
  const p = zonedParts(at);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Month in the network zone, as YYYY-MM. */
export function zonedMonth(at: Date): string {
  const p = zonedParts(at);
  return `${pad(p.year, 4)}-${pad(p.month)}`;
}

/** `YYYY-MM-DD HH:MM` in the network zone, used by the earnings CSV. */
export function zonedStamp(at: Date): string {
  return `${zonedDate(at)} ${zonedTime(at)}`;
}

export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = fromZoned(Number(y), Number(m), Number(d), 0, 0);
  if (zonedDate(date) !== value) return null;
  return date;
}

export function parseMonth(value: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const start = fromZoned(year, month, 1, 0, 0);
  const end = month === 12 ? fromZoned(year + 1, 1, 1, 0, 0) : fromZoned(year, month + 1, 1, 0, 0);
  return { start, end };
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60000);
}

export function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86_400_000);
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

export function parseHhMm(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}
