import { COPENHAGEN_ZONE, marketCity, marketZone, type Market } from './markets.ts';

export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = partsCache.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(zone, found);
  }
  return found;
}

/** The wall-clock fields of an instant in a zone. */
export function wallOf(zone: string, instantMs: number): Wall {
  const parts = formatter(zone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
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

/** Wall-clock fields encoded as the instant they would be if the zone were UTC. */
export function wallToPseudo(wall: Wall): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

export function pseudoToWall(pseudoMs: number): Wall {
  const date = new Date(pseudoMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function offsetMs(zone: string, instantMs: number): number {
  return wallToPseudo(wallOf(zone, instantMs)) - instantMs;
}

export type ResolutionKind = 'ok' | 'gap' | 'ambiguous';

export interface Resolution {
  kind: ResolutionKind;
  /** The chosen instant: the only one, the first of a repeated pair, or the one after a gap. */
  instantMs: number;
  /** Length of the spring-forward gap in milliseconds, 0 unless `kind` is `gap`. */
  gapMs: number;
}

/**
 * Turns wall-clock fields in a zone into an instant.
 *
 * A time inside a spring-forward gap resolves to the instant that gap's length later, and a
 * repeated autumn time resolves to its first occurrence.
 */
export function resolveWall(zone: string, wall: Wall): Resolution {
  const pseudo = wallToPseudo(wall);
  const offsetBefore = offsetMs(zone, pseudo - DAY_MS);
  const offsetAfter = offsetMs(zone, pseudo + DAY_MS);
  const candidates = [...new Set([pseudo - offsetBefore, pseudo - offsetAfter])]
    .filter((candidate) => wallToPseudo(wallOf(zone, candidate)) === pseudo)
    .sort((a, b) => a - b);
  const first = candidates[0];
  if (first === undefined) {
    return { kind: 'gap', instantMs: pseudo - offsetBefore, gapMs: offsetAfter - offsetBefore };
  }
  return { kind: candidates.length > 1 ? 'ambiguous' : 'ok', instantMs: first, gapMs: 0 };
}

// --- Copenhagen calendar -----------------------------------------------------

export function copenhagenWall(instantMs: number): Wall {
  return wallOf(COPENHAGEN_ZONE, instantMs);
}

export function copenhagenToday(nowMs: number): string {
  return formatDateParts(copenhagenWall(nowMs));
}

export function copenhagenTomorrow(nowMs: number): string {
  const wall = copenhagenWall(nowMs);
  return formatDateParts(pseudoToWall(wallToPseudo({ ...wall, hour: 12 }) + DAY_MS));
}

export function formatDateParts(wall: Wall): string {
  return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
}

export function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, '0');
}

export interface IsoWeek {
  week: number;
  isoYear: number;
}

/** The ISO week of a calendar date. */
export function isoWeekOfDate(year: number, month: number, day: number): IsoWeek {
  const pseudo = Date.UTC(year, month - 1, day);
  const date = new Date(pseudo);
  const dayOfWeek = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const thursday = new Date(pseudo + (4 - dayOfWeek) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = Date.UTC(isoYear, 0, 4);
  const firstDate = new Date(firstThursday);
  const firstDayOfWeek = firstDate.getUTCDay() === 0 ? 7 : firstDate.getUTCDay();
  const week1Monday = firstThursday - (firstDayOfWeek - 1) * DAY_MS;
  const week = Math.floor((thursday.getTime() - week1Monday) / (7 * DAY_MS)) + 1;
  return { week, isoYear };
}

export function isoWeekOfInstant(instantMs: number): IsoWeek {
  const wall = copenhagenWall(instantMs);
  return isoWeekOfDate(wall.year, wall.month, wall.day);
}

/** The API week value, `YYYY-Www`. */
export function weekValue(week: IsoWeek): string {
  return `${pad(week.isoYear, 4)}-W${pad(week.week, 2)}`;
}

/** The on-screen week label, `Week <w> · <ISO year>`. */
export function weekLabel(week: IsoWeek): string {
  return `Week ${week.week} · ${week.isoYear}`;
}

export function parseWeekValue(value: string): IsoWeek | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  return { week, isoYear };
}

// --- Parsing -----------------------------------------------------------------

export function parseDate(value: string): Wall | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
  return formatDateParts(pseudoToWall(wallToPseudo(wall))) === value ? wall : null;
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`, without a zone. */
export function parseLocalDateTime(value: string): Wall | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const date = parseDate(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { ...date, hour, minute, second };
}

/** A whole-second UTC instant like `2027-03-18T09:00:00Z`. */
export function parseInstant(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
  if (!match) return null;
  const wall = parseLocalDateTime(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`);
  return wall === null ? null : wallToPseudo(wall);
}

// --- Formatting --------------------------------------------------------------

export function formatInstant(instantMs: number): string {
  const wall = pseudoToWall(Math.floor(instantMs / 1000) * 1000);
  return `${formatDateParts(wall)}T${pad(wall.hour, 2)}:${pad(wall.minute, 2)}:${pad(wall.second, 2)}Z`;
}

/** `YYYY-MM-DDTHH:MM`, with seconds only when they are not zero. */
export function formatLocalDateTime(wall: Wall): string {
  const base = `${formatDateParts(wall)}T${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`;
  return wall.second === 0 ? base : `${base}:${pad(wall.second, 2)}`;
}

export function formatTimeOfDay(wall: Wall): string {
  return `${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(wall: Wall): string {
  return DAY_NAMES[new Date(wallToPseudo(wall)).getUTCDay()] as string;
}

/** The long weekday name, used in the weekly-restock copy. */
export function weekdayLongName(wall: Wall): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(wallToPseudo(wall)),
  );
}

/** `Thu 18 Mar 2027` */
export function formatWallDate(wall: Wall): string {
  return `${weekdayName(wall)} ${wall.day} ${MONTH_NAMES[wall.month - 1]} ${pad(wall.year, 4)}`;
}

/** `Thu 18 Mar 2027` for a Copenhagen date string. */
export function formatCopenhagenDate(date: string): string {
  const wall = parseDate(date);
  return wall === null ? date : formatWallDate(wall);
}

/** `Thu 18 Mar 2027, 10:00 Copenhagen time` */
export function formatMarketTime(instantMs: number, market: Market): string {
  const wall = wallOf(marketZone(market), instantMs);
  return `${formatWallDate(wall)}, ${formatTimeOfDay(wall)} ${marketCity(market)} time`;
}

export function formatCopenhagenInstant(instantMs: number): string {
  return formatMarketTime(instantMs, 'copenhagen');
}

/** `HH:MM:SS`, prefixed with `<d>d ` when at least a day remains. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}
