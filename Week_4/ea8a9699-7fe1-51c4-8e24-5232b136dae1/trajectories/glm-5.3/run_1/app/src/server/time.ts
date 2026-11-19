// Time rules: embargo resolution in a workspace's time zone and the lift instant.

import { DateTime } from 'luxon';
import type { ClusterStatus } from '../shared/types.js';

export function nowDate(): Date {
  return new Date();
}

/** Resolve a wall-clock liftLocal in the workspace zone.
 *
 * A local time in the spring-forward gap is invalid. A fall-back ambiguous time
 * resolves to its earlier occurrence.
 */
export function resolveLift(liftLocal: string, timeZone: string): { instant: Date } | { gap: true } | { invalid: true } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(liftLocal);
  if (!m) return { invalid: true };
  const [, y, mo, d, h, mi] = m;
  const parts = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi) };
  const naive = DateTime.fromObject(parts, { zone: 'utc' });
  if (!naive.isValid) return { invalid: true };

  // A local wall time T maps to the instant T - offset for each offset the zone
  // has around that date. Collect the distinct offsets around the naive guess.
  const offsets = new Set<number>();
  for (const deltaHours of [-3, -2, -1, 0, 1, 2, 3]) {
    const probe = naive.plus({ hours: deltaHours }).setZone(timeZone);
    offsets.add(probe.offset);
  }
  const matches: DateTime[] = [];
  for (const offset of offsets) {
    const candidate = naive.minus({ minutes: offset });
    const back = candidate.setZone(timeZone);
    if (back.year === parts.year && back.month === parts.month && back.day === parts.day && back.hour === parts.hour && back.minute === parts.minute) {
      matches.push(candidate);
    }
  }
  if (matches.length === 0) return { gap: true };
  matches.sort((a, b) => a.toMillis() - b.toMillis());
  return { instant: matches[0]!.toJSDate() };
}

/** Format an instant as the workspace's wall-clock liftLocal (YYYY-MM-DDTHH:MM). */
export function liftLocalOf(instant: Date, timeZone: string): string {
  return DateTime.fromJSDate(instant).setZone(timeZone).toFormat('yyyy-MM-dd\'T\'HH:mm');
}

/** Format the lift summary instant (YYYY-MM-DD HH:MM in UTC). */
export function liftInstantSummary(instant: Date): string {
  return DateTime.fromJSDate(instant).toUTC().toFormat('yyyy-MM-dd HH:mm');
}

/** Format a UTC instant for the review banner (YYYY-MM-DD HH:MM). */
export function reviewExpirySummary(instant: Date): string {
  return DateTime.fromJSDate(instant).toUTC().toFormat('yyyy-MM-dd HH:mm');
}

export function formatLiftLocal(liftLocal: string): string {
  return liftLocal.replace('T', ' ');
}

export function liftLocalInput(instant: Date, timeZone: string): string {
  return liftLocalOf(instant, timeZone);
}

/** The effective status of a cluster at an instant: embargo lifts exactly at liftsAt. */
export function effectiveStatusOf(status: ClusterStatus, liftsAt: Date | null, at: Date): ClusterStatus {
  if (status === 'embargoed' && liftsAt && at.getTime() >= liftsAt.getTime()) return 'public';
  return status;
}
