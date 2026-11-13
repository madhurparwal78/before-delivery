/** Run limit and swap claim checks, over derived nights. */
import { Temporal } from '@js-temporal/polyfill';
import { NightInterval, PlainDate, addDays, daysBetween, overlaps, parseDate } from '../lib/time';
import { DerivedSwap, VersionForNight } from './derived';
import { deriveNight, versionInEffect } from './derive';
import { ParentRole } from './plan';

/** Derive owners for each night in an interval, applying the hypothetical
 *  accepted swap on top of existing accepted swaps. */
export function ownersWith(
  versions: VersionForNight[],
  swaps: DerivedSwap[],
  extra: DerivedSwap | null,
  interval: NightInterval,
  extraRoleAt: (d: PlainDate) => ParentRole | null,
): Map<string, ParentRole | null> {
  const out = new Map<string, ParentRole | null>();
  let d = parseDate(interval.first);
  const last = parseDate(interval.last);
  while (Temporal.PlainDate.compare(d, last) <= 0) {
    if (extra && coversInterval(extra.nights, d)) {
      out.set(d.toString(), extra.toParent);
    } else if (extra && extra.makeupNights && coversInterval(extra.makeupNights, d)) {
      out.set(d.toString(), otherOf(extra.toParent));
    } else if (extraRoleAt && extraRoleAt(d) !== null) {
      out.set(d.toString(), extraRoleAt(d));
    } else {
      out.set(d.toString(), deriveNight(versions, swaps, d).owner);
    }
    d = addDays(d, 1);
  }
  return out;
}

function coversInterval(iv: NightInterval, d: PlainDate): boolean {
  return Temporal.PlainDate.compare(parseDate(iv.first), d) <= 0
    && Temporal.PlainDate.compare(d, parseDate(iv.last)) <= 0;
}

export function otherOf(role: ParentRole): ParentRole {
  return role === 'planning' ? 'other' : 'planning';
}

/** Run-limit check: applied with accepted swaps over derived nights, across
 *  year and version boundaries. Returns true when any moved night sits in a
 *  same-owner run longer than the version's maxConsecutiveNights. */
export function runTooLong(
  versions: VersionForNight[],
  swaps: DerivedSwap[],
  candidate: DerivedSwap,
): boolean {
  const moved: NightInterval[] = [candidate.nights];
  if (candidate.makeupNights) moved.push(candidate.makeupNights);
  // scan a window around all moved intervals, extended by max limit (60)
  let earliest = parseDate(candidate.nights.first);
  let latest = parseDate(candidate.nights.last);
  for (const iv of moved) {
    if (Temporal.PlainDate.compare(parseDate(iv.first), earliest) < 0) earliest = parseDate(iv.first);
    if (Temporal.PlainDate.compare(parseDate(iv.last), latest) > 0) latest = parseDate(iv.last);
  }
  const winStart = addDays(earliest, -61);
  const winEnd = addDays(latest, 61);
  const owners = new Map<string, ParentRole | null>();
  let d = winStart;
  while (Temporal.PlainDate.compare(d, winEnd) <= 0) {
    if (coversInterval(candidate.nights, d)) {
      owners.set(d.toString(), candidate.toParent);
    } else if (candidate.makeupNights && coversInterval(candidate.makeupNights, d)) {
      owners.set(d.toString(), otherOf(candidate.toParent));
    } else {
      owners.set(d.toString(), deriveNight(versions, swaps, d).owner);
    }
    d = addDays(d, 1);
  }
  // for each moved night, walk its same-owner run under the version in effect
  for (const iv of moved) {
    let cur = parseDate(iv.first);
    const ivLast = parseDate(iv.last);
    while (Temporal.PlainDate.compare(cur, ivLast) <= 0) {
      const owner = owners.get(cur.toString()) ?? null;
      if (owner !== null) {
        // walk back
        let start = cur;
        while (owners.get(addDays(start, -1).toString()) === owner) start = addDays(start, -1);
        let end = cur;
        while (owners.get(addDays(end, 1).toString()) === owner) end = addDays(end, 1);
        const len = daysBetween(start, end) + 1;
        const v = versionInEffect(versions, cur);
        const max = v?.maxConsecutiveNights ?? null;
        if (max !== null && len > max) return true;
      }
      cur = addDays(cur, 1);
    }
  }
  return false;
}

/** Swap nights claimed by a swap: both intervals. */
export function claimedNights(s: DerivedSwap): NightInterval[] {
  return s.makeupNights ? [s.nights, s.makeupNights] : [s.nights];
}

export function intervalsOverlap(a: NightInterval, b: NightInterval): boolean {
  return overlaps(a, b);
}
