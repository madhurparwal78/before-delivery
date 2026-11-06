import type { OfficeId } from '../../shared/types.js';
import {
  addDays,
  formatIsoDate,
  isWeekend,
  parseLocalDateTime,
  zonedToInstant,
  type CivilDate,
} from '../../shared/zone.js';

export type OfficeInfo = {
  id: OfficeId;
  city: string;
  timeZone: string;
  closures: Set<string>;
};

export function isBusinessDay(office: OfficeInfo, date: CivilDate): boolean {
  return !isWeekend(date) && !office.closures.has(formatIsoDate(date));
}

/** 12:00 office time on the latest business day strictly before the job day. */
export function automaticReleaseInstant(office: OfficeInfo, jobDate: CivilDate): number {
  let candidate = addDays(jobDate, -1);
  for (let step = 0; step < 60; step += 1) {
    if (isBusinessDay(office, candidate)) break;
    candidate = addDays(candidate, -1);
  }
  const resolved = zonedToInstant(office.timeZone, { ...candidate, hour: 12, minute: 0, second: 0 });
  if (resolved.kind !== 'ok') throw new Error(`no noon on ${formatIsoDate(candidate)} in ${office.timeZone}`);
  return resolved.instantMs;
}

export type HoldUntilResolution =
  | { kind: 'ok'; instantMs: number }
  | { kind: 'malformed' }
  | { kind: 'gap' };

/** Office-local hold-until: the gap is refused, a repeated hour takes its first occurrence. */
export function resolveHoldUntil(office: OfficeInfo, value: string): HoldUntilResolution {
  const local = parseLocalDateTime(value);
  if (!local) return { kind: 'malformed' };
  const resolved = zonedToInstant(office.timeZone, local);
  if (resolved.kind === 'gap') return { kind: 'gap' };
  return { kind: 'ok', instantMs: resolved.instantMs };
}
