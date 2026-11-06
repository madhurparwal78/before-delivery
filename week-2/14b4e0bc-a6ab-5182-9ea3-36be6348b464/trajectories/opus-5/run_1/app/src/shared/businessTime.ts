import { BUSINESS_TIME_ZONE } from './domain.ts';

const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

function zoneOffsetMinutes(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = read('hour') % 24;
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
  return Math.round((asUtc - instantMs) / 60000);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export interface BusinessTime {
  /** The wall time actually used, which is shifted forward across a skipped hour. */
  wall: string;
  offsetMinutes: number;
  /** The RFC 3339 instant to send as as_of_time, for example 2026-09-30T23:59:59-05:00. */
  rfc3339: string;
  instantMs: number;
}

/**
 * Converts a business wall time (YYYY-MM-DDTHH:mm:ss) in America/Chicago to an instant.
 * A repeated fall-back hour takes the earlier offset; a skipped spring-forward hour moves
 * forward by the length of the gap.
 */
export function businessWallTimeToInstant(wallTime: string, timeZone = BUSINESS_TIME_ZONE): BusinessTime | null {
  const match = WALL_TIME_PATTERN.exec(wallTime);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    new Date(naive).getUTCMonth() !== month - 1 ||
    new Date(naive).getUTCDate() !== day
  ) {
    return null;
  }

  // Candidate offsets around the wall time, earliest-first so a repeated hour takes the earlier one.
  const probes = [naive - 86400000, naive + 86400000];
  const candidates = [...new Set(probes.map((p) => zoneOffsetMinutes(p, timeZone)))].sort((a, b) => b - a);
  for (const offsetMinutes of candidates) {
    const instantMs = naive - offsetMinutes * 60000;
    if (zoneOffsetMinutes(instantMs, timeZone) === offsetMinutes) {
      return {
        wall: wallTime,
        offsetMinutes,
        rfc3339: `${wallTime}${formatOffset(offsetMinutes)}`,
        instantMs,
      };
    }
  }

  // Skipped wall time: move forward by the gap between the two offsets.
  const before = candidates[candidates.length - 1];
  const after = candidates[0];
  const gapMinutes = after - before;
  const shifted = naive + gapMinutes * 60000;
  const shiftedDate = new Date(shifted);
  const wall = `${pad(shiftedDate.getUTCFullYear(), 4)}-${pad(shiftedDate.getUTCMonth() + 1, 2)}-${pad(
    shiftedDate.getUTCDate(),
    2,
  )}T${pad(shiftedDate.getUTCHours(), 2)}:${pad(shiftedDate.getUTCMinutes(), 2)}:${pad(
    shiftedDate.getUTCSeconds(),
    2,
  )}`;
  return {
    wall,
    offsetMinutes: after,
    rfc3339: `${wall}${formatOffset(after)}`,
    instantMs: shifted - after * 60000,
  };
}

const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Parses an RFC 3339 instant that carries Z or an explicit offset. */
export function parseRfc3339WithOffset(value: string): number | null {
  if (!RFC3339_PATTERN.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Formats an instant in the viewer's own zone: YYYY-MM-DD HH:mm:ss.sss UTC±HH:MM. */
export function formatViewerZoneTime(iso: string): string {
  const date = new Date(iso);
  const offsetMinutes = -date.getTimezoneOffset();
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ` +
    `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.` +
    `${pad(date.getMilliseconds(), 3)} UTC${formatOffset(offsetMinutes)}`
  );
}

/** All server times are UTC strings formatted YYYY-MM-DDTHH:mm:ss.sssZ. */
export function serverTime(instantMs: number = Date.now()): string {
  return new Date(instantMs).toISOString();
}
