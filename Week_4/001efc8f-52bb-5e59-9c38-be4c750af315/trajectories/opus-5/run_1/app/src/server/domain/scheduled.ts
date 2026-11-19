import { localIso, wallTimeToInstant } from '../../shared/zone';
import type { RepeatRule, Scheduled, ScheduledState } from '../../shared/api';
import { isoOrNull } from '../clock';

const WEEK_MS = 7 * 86_400_000;

export interface ScheduledRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  created_by: string;
  text: string;
  state: ScheduledState;
  repeat_rule: RepeatRule;
  local_date: string;
  local_time: string;
  next_fire_at: Date | null;
  fired_count: number;
  last_message_id: string | null;
}

export function parseLocalDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function parseLocalTime(value: unknown): { hour: number; minute: number; second: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/**
 * The one local-time-to-instant conversion for scheduled posts. A wall time
 * the clocks skip moves forward by the jump; one that happens twice fires at
 * its first occurrence.
 */
export function occurrenceAt(localDate: string, localTime: string, zone: string, weeksAhead: number): number {
  const date = parseLocalDate(localDate);
  const time = parseLocalTime(localTime);
  if (date === null || time === null) return Number.NaN;
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + weeksAhead * 7));
  return wallTimeToInstant(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    time.hour,
    time.minute,
    time.second,
    zone,
  );
}

export function occurrencesFrom(
  row: Pick<ScheduledRow, 'local_date' | 'local_time' | 'repeat_rule'>,
  zone: string,
  fromMs: number,
  count: number,
): number[] {
  const first = occurrenceAt(row.local_date, row.local_time, zone, 0);
  if (Number.isNaN(first)) return [];
  if (row.repeat_rule === 'none') return first >= fromMs ? [first] : [];
  const behind = fromMs > first ? Math.max(0, Math.floor((fromMs - first) / WEEK_MS) - 1) : 0;
  const found: number[] = [];
  for (let week = behind; found.length < count && week < behind + count + 8; week += 1) {
    const instant = occurrenceAt(row.local_date, row.local_time, zone, week);
    if (instant >= fromMs) found.push(instant);
  }
  return found;
}

/** The most recent occurrence at or before `atMs`, used when a firing is late. */
export function latestOccurrenceAtOrBefore(
  row: Pick<ScheduledRow, 'local_date' | 'local_time' | 'repeat_rule'>,
  zone: string,
  atMs: number,
): number | null {
  const first = occurrenceAt(row.local_date, row.local_time, zone, 0);
  if (Number.isNaN(first) || first > atMs) return null;
  if (row.repeat_rule === 'none') return first;
  const weeks = Math.floor((atMs - first) / WEEK_MS);
  for (let week = weeks + 1; week >= 0; week -= 1) {
    const instant = occurrenceAt(row.local_date, row.local_time, zone, week);
    if (instant <= atMs) return instant;
  }
  return first;
}

export function scheduledShape(row: ScheduledRow, zone: string, nowMs: number): Scheduled {
  const finished = row.state === 'sent' || row.state === 'cancelled';
  const fromMs = row.next_fire_at === null ? nowMs : row.next_fire_at.getTime();
  const upcoming = finished ? [] : occurrencesFrom(row, zone, fromMs, row.repeat_rule === 'weekly' ? 3 : 1);
  return {
    id: row.id,
    channel_id: row.channel_id,
    text: row.text,
    state: row.state,
    repeat: row.repeat_rule,
    local_date: row.local_date,
    local_time: row.local_time,
    time_zone: zone,
    next_fire_at: finished ? null : isoOrNull(row.next_fire_at),
    next_fire_local: finished || row.next_fire_at === null ? null : localIso(row.next_fire_at.getTime(), zone),
    upcoming_local: upcoming.map((instant) => localIso(instant, zone)),
    fired_count: row.fired_count,
    last_message_id: row.last_message_id,
  };
}
