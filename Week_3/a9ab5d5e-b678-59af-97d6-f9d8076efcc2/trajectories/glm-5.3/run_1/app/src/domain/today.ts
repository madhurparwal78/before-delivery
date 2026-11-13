/** Today, custody day, and per-night versions: decided here and nowhere else. */
import { Temporal } from '@js-temporal/polyfill';
import { Instant, PlainDate, PlainTime, localDate, parseDate, zonedAt } from '../lib/time';
import { VersionForNight } from './derived';

/** A household's today: the server clock's date in the zone of the adopted
 *  version with the latest effectiveFrom on or before its own local date;
 *  before that the earliest adopted version's; with none, the draft's;
 *  with neither, UTC. */
export function householdToday(adopted: VersionForNight[], draft: VersionForNight | null, now: Instant): PlainDate {
  // candidates in order of preference
  const candidates: Array<{ effectiveFrom: string; zone: string }> = [];
  for (const v of [...adopted].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    candidates.push({ effectiveFrom: v.effectiveFrom, zone: v.exchangeZone });
  }
  // pick the version with latest effectiveFrom <= its own local date
  let chosen: string | null = null;
  for (const c of candidates) {
    const effLocal = localDate(now, c.zone);
    if (Temporal.PlainDate.compare(parseDate(c.effectiveFrom), effLocal) <= 0) {
      chosen = c.zone;
    }
  }
  if (chosen === null) {
    chosen = candidates.length > 0 ? candidates[0].zone : draft?.exchangeZone ?? 'UTC';
  }
  return localDate(now, chosen);
}

/** Custody day D runs from the exchange time of the version in effect on D
 *  to that of D+1, half-open, in that version's zone. Returns the custody
 *  day containing the instant. */
export function custodyDayOf(versions: VersionForNight[], instant: Instant): string | null {
  // search a window around the instant's UTC date
  const d0 = localDate(instant, 'UTC');
  for (let offset = -2; offset <= 2; offset++) {
    const day = d0.add({ days: offset });
    const start = custodyDayStart(versions, day);
    const next = custodyDayStart(versions, day.add({ days: 1 }));
    if (start && next) {
      if (instant.epochNanoseconds >= start.epochNanoseconds && instant.epochNanoseconds < next.epochNanoseconds) {
        return day.toString();
      }
    }
  }
  return null;
}

function custodyDayStart(versions: VersionForNight[], day: PlainDate): Instant | null {
  const v = versionInEffectOn(versions, day);
  if (!v) return null;
  const time = exchangeTimeOf(v);
  return zonedAt(day, time, v.exchangeZone).toInstant();
}

function versionInEffectOn(versions: VersionForNight[], day: PlainDate): VersionForNight | null {
  let found: VersionForNight | null = null;
  for (const v of versions) {
    if (Temporal.PlainDate.compare(parseDate(v.effectiveFrom), day) <= 0) {
      if (!found || Temporal.PlainDate.compare(parseDate(found.effectiveFrom), parseDate(v.effectiveFrom)) < 0) {
        found = v;
      }
    }
  }
  return found;
}

export function exchangeTimeOf(v: VersionForNight): PlainTime {
  return Temporal.PlainDateTime.from(v.firstExchangeAt.replace(/([+-]\d{2}:\d{2}|Z)$/, '')).toPlainTime();
}

/** The version in effect on a night, as VersionForNight. */
export function versionForNight(versions: VersionForNight[], day: PlainDate): VersionForNight | null {
  return versionInEffectOn(versions, day);
}
