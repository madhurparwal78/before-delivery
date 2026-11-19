import type { ZoneEntry } from '../../shared/zones.js';
import { ZONES } from '../../shared/zones.js';

export { ZONES };
export type { ZoneEntry };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function zoneEntry(zone: string): ZoneEntry | null {
  return ZONES.find((entry) => entry.name === zone) ?? null;
}

export function isAllowedZone(zone: unknown): zone is string {
  return typeof zone === 'string' && zoneEntry(zone) !== null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    formatters.set(zone, found);
  }
  return found;
}

export function partsIn(zone: string, instant: Date): LocalParts & { second: number } {
  const parts = formatter(zone).formatToParts(instant);
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second')
  };
}

export function offsetMinutes(zone: string, instant: Date): number {
  const local = partsIn(zone, instant);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return (asUtc - instant.getTime()) / 60000;
}

export function abbreviation(zone: string, instant: Date): string {
  const entry = zoneEntry(zone);
  if (!entry) return '';
  const offset = offsetMinutes(zone, instant);
  if (offset === entry.standardOffset || entry.daylightAbbreviation === null) return entry.standardAbbreviation;
  return entry.daylightAbbreviation;
}

export function formatDisplay(zone: string, instant: Date): string {
  const local = partsIn(zone, instant);
  const weekday = WEEKDAYS[new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()] ?? '';
  const month = MONTHS[local.month - 1] ?? '';
  const suffix = local.hour < 12 ? 'AM' : 'PM';
  const hour12 = local.hour % 12 === 0 ? 12 : local.hour % 12;
  const minute = String(local.minute).padStart(2, '0');
  return `${weekday} ${local.day} ${month} ${local.year}, ${hour12}:${minute} ${suffix} ${abbreviation(zone, instant)}`;
}

export function formatLocalStamp(parts: LocalParts): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseLocalStamp(text: unknown): LocalParts | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  if (parts.hour > 23 || parts.minute > 59) return null;
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) return null;
  return parts;
}

export type LocalKind = 'exact' | 'gap' | 'ambiguous';

export interface ResolvedLocal {
  instant: Date;
  kind: LocalKind;
  parts: LocalParts;
}

export function resolveLocal(zone: string, wanted: LocalParts): ResolvedLocal {
  const naive = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
  const entry = zoneEntry(zone);
  const offsets =
    entry === null
      ? [offsetMinutes(zone, new Date(naive))]
      : entry.daylightAbbreviation === null
        ? [entry.standardOffset]
        : [entry.standardOffset, entry.standardOffset + 60];
  const candidates = new Set<number>(offsets.map((offset) => naive - offset * 60000));
  const matching = [...candidates].filter((candidate) => {
    const local = partsIn(zone, new Date(candidate));
    return (
      local.year === wanted.year &&
      local.month === wanted.month &&
      local.day === wanted.day &&
      local.hour === wanted.hour &&
      local.minute === wanted.minute
    );
  });
  if (matching.length === 0) {
    const moved = new Date(Math.max(...candidates));
    const local = partsIn(zone, moved);
    return {
      instant: moved,
      kind: 'gap',
      parts: { year: local.year, month: local.month, day: local.day, hour: local.hour, minute: local.minute }
    };
  }
  const chosen = new Date(Math.min(...matching));
  return { instant: chosen, kind: matching.length > 1 ? 'ambiguous' : 'exact', parts: wanted };
}

export function addDays(parts: LocalParts, days: number): LocalParts {
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute
  };
}
