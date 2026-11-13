import { config } from './config';
import { formatIsoDate } from '../shared/format';

export interface WorkspaceRecord {
  id: string;
  time_zone: string;
  units: 'mm' | 'm';
  created_at: Date;
  clock_set_real: Date | null;
  clock_set_now: Date | null;
}

/**
 * The workspace's server now: the real clock, unless a grading clock was set,
 * in which case time runs forward in real time from the set instant.
 */
export function workspaceNow(workspace: WorkspaceRecord): Date {
  if (workspace.clock_set_real === null || workspace.clock_set_now === null) return new Date();
  const elapsed = Date.now() - workspace.clock_set_real.getTime();
  return new Date(workspace.clock_set_now.getTime() + elapsed);
}

export function studioToday(workspace: WorkspaceRecord): string {
  return formatIsoDate(workspaceNow(workspace), workspace.time_zone);
}

function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const wall = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return wall - instant.getTime();
}

/** The instant of a wall-clock time in an IANA zone. */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wall - zoneOffsetMs(new Date(wall), zone);
  instant = wall - zoneOffsetMs(new Date(instant), zone);
  return new Date(instant);
}

export function parseIsoDate(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. */
export function calendarDaysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a === null || b === null) throw new Error('invalid studio date');
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86_400_000);
}

export interface TrialState {
  days_left: number;
  ended: boolean;
}

/** The one decision for trial days left. */
export function trialState(confirmedOn: string | null, workspace: WorkspaceRecord): TrialState {
  if (confirmedOn === null) return { days_left: config.trialDays, ended: false };
  const elapsed = calendarDaysBetween(confirmedOn, studioToday(workspace));
  const daysLeft = Math.max(0, config.trialDays - elapsed);
  return { days_left: daysLeft, ended: daysLeft === 0 };
}

/** The instant a link with this expiry date stops working: 23:59:59 studio time. */
export function linkExpiryInstant(expiryDate: string | null, zone: string): Date | null {
  if (expiryDate === null) return null;
  const parsed = parseIsoDate(expiryDate);
  if (parsed === null) return null;
  return zonedInstant(parsed.year, parsed.month, parsed.day, 23, 59, 59, zone);
}
