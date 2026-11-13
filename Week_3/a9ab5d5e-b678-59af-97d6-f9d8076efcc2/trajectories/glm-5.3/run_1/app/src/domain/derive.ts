/** Night ownership and precedence: decided here and nowhere else. */
import { Temporal } from '@js-temporal/polyfill';
import { westernEaster } from '../lib/easter';
import {
  NightInterval, PlainDate, PlainTime,
  addDays, daysBetween, parseDate, zonedAt,
} from '../lib/time';
import { PlanRule, ParentRole, SchoolBreakRule, VacationRule, HolidayRule } from './plan';
import { DayOwner, Handover, YearDay, YearDoc, VersionForNight, DerivedSwap } from './derived';

export interface VersionAt<D> {
  (d: D): VersionForNight | null;
}

/** The version in effect on a night: latest effectiveFrom on or before it. */
export function versionInEffect(versions: VersionForNight[], d: PlainDate): VersionForNight | null {
  let found: VersionForNight | null = null;
  for (const v of versions) {
    if (Temporal.PlainDate.compare(parseDate(v.effectiveFrom), d) <= 0) {
      if (!found || Temporal.PlainDate.compare(parseDate(found.effectiveFrom), parseDate(v.effectiveFrom)) < 0) {
        found = v;
      }
    }
  }
  return found;
}

interface Occurrence {
  ruleId: string;
  ruleName: string;
  kind: 'holiday' | 'school_break' | 'vacation';
  first: PlainDate;
  last: PlainDate;
  ownerAt(d: PlainDate): ParentRole;
  order: number;
  exchangeZone?: string;
  exchangeTime?: PlainTime;
}

/** A holiday's anchor date for a given year, or null when it does not occur. */
export function holidayAnchor(rule: HolidayRule, year: number): PlainDate | null {
  switch (rule.date.type) {
    case 'fixed':
      return new Temporal.PlainDate(year, rule.date.month, rule.date.day);
    case 'easter': {
      const e = westernEaster(year);
      return new Temporal.PlainDate(year, e.month, e.day);
    }
    case 'nth_weekday': {
      return nthWeekday(year, rule.date.month, rule.date.weekday, rule.date.n);
    }
  }
}

function daysInMonth(year: number, month: number): number {
  const d = new Temporal.PlainDate(year, month, 1);
  return d.daysInMonth;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): PlainDate | null {
  if (n === -1) {
    let d = new Temporal.PlainDate(year, month, daysInMonth(year, month));
    while (d.dayOfWeek !== weekday) d = addDays(d, -1);
    return d;
  }
  let d = new Temporal.PlainDate(year, month, 1);
  if (d.dayOfWeek !== weekday) {
    const delta = (weekday - d.dayOfWeek + 7) % 7;
    d = addDays(d, delta);
  }
  if (d.month !== month) return null;
  d = addDays(d, (n - 1) * 7);
  if (d.month !== month) return null;
  return d;
}

/** Collect all occurrences covering nights between two dates, for holidays of every year involved. */
function holidayOccurrences(rule: HolidayRule, order: number, from: PlainDate, to: PlainDate): Occurrence[] {
  const out: Occurrence[] = [];
  // anchor year can be from (offset -7..7) to cover boundaries; check years around the range
  for (let y = from.year - 1; y <= to.year + 1; y++) {
    const anchor = holidayAnchor(rule, y);
    if (!anchor) continue;
    const first = addDays(anchor, rule.startOffset);
    const last = addDays(first, rule.nights - 1);
    if (Temporal.PlainDate.compare(last, from) < 0) continue;
    if (Temporal.PlainDate.compare(first, to) > 0) continue;
    const odd = y % 2 === 1;
    const owner = odd ? rule.oddYears : rule.evenYears;
    out.push(makeOccurrence(rule, order, first, last, () => owner, rule.kind, undefined, undefined));
  }
  return out;
}

function makeOccurrence(
  rule: PlanRule,
  order: number,
  first: PlainDate,
  last: PlainDate,
  ownerAt: (d: PlainDate) => ParentRole,
  kind: Occurrence['kind'],
  exchangeZone: string | undefined,
  exchangeTime: PlainTime | undefined,
): Occurrence {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    kind,
    first,
    last,
    ownerAt,
    order,
    exchangeZone,
    exchangeTime,
  };
}

function breakOccurrences(rule: SchoolBreakRule, order: number): Occurrence[] {
  const [f, l] = rule.nights.split('/');
  const first = parseDate(f);
  const last = parseDate(l);
  const total = daysBetween(first, last) + 1;
  const odd = first.year % 2 === 1;
  const firstHalfOwner = odd ? rule.firstHalfOddYears : otherOf(rule.firstHalfOddYears);
  const secondHalfOwner = otherOf(firstHalfOwner);
  const firstHalfLen = Math.ceil(total / 2);
  const ownerAt = (d: PlainDate) => {
    if (rule.split === 'whole') return firstHalfOwner;
    const idx = daysBetween(first, d);
    return idx < firstHalfLen ? firstHalfOwner : secondHalfOwner;
  };
  return [makeOccurrence(rule, order, first, last, ownerAt, 'school_break', undefined, undefined)];
}

function vacationOccurrences(rule: VacationRule, order: number): Occurrence[] {
  const [f, l] = rule.nights.split('/');
  const first = parseDate(f);
  const last = parseDate(l);
  const ownerAt = () => rule.parent;
  const zone = rule.exchangeZone;
  const time = rule.firstExchangeAt
    ? Temporal.PlainDateTime.from(rule.firstExchangeAt.replace(/([+-]\d{2}:\d{2}|Z)$/, '')).toPlainTime()
    : undefined;
  return [makeOccurrence(rule, order, first, last, ownerAt, 'vacation', zone, time)];
}

function otherOf(role: ParentRole): ParentRole {
  return role === 'planning' ? 'other' : 'planning';
}

/** All occurrences of a version's rules between two dates, in rule order. */
export function occurrencesBetween(v: VersionForNight, from: PlainDate, to: PlainDate): Occurrence[] {
  const out: Occurrence[] = [];
  v.rules.forEach((rule, order) => {
    if (rule.kind === 'holiday') out.push(...holidayOccurrences(rule, order, from, to));
    else if (rule.kind === 'school_break') out.push(...breakOccurrences(rule, order));
    else out.push(...vacationOccurrences(rule, order));
  });
  return out.filter((o) => Temporal.PlainDate.compare(o.last, from) >= 0
    && Temporal.PlainDate.compare(o.first, to) <= 0);
}

function baseOwner(v: VersionForNight, d: PlainDate): ParentRole | null {
  const anchor = parseDate(v.anchor);
  const len = v.pattern.length;
  const idx = ((daysBetween(anchor, d) % len) + len) % len;
  const letter = v.pattern[idx];
  return letter === 'P' ? 'planning' : 'other';
}

export interface SwapOwner {
  swap: DerivedSwap;
  owner: ParentRole;
}

/** Derive one night: precedence swap > holiday > school break > vacation > base. */
export function deriveNight(
  versions: VersionForNight[],
  swaps: DerivedSwap[],
  d: PlainDate,
): DayOwner {
  const v = versionInEffect(versions, d);
  if (!v) return { owner: null, ruleId: null, kind: null, ruleName: null, beats: null };

  // swaps: accepted or settled only
  for (const s of swaps) {
    if (covers(s.nights, d)) return {
      owner: s.toParent, ruleId: `swap:${s.id}`, kind: 'swap', ruleName: 'Swap', beats: null,
    };
    if (s.makeupNights && covers(s.makeupNights, d)) return {
      owner: otherOf(s.toParent), ruleId: `swap:${s.id}`, kind: 'swap', ruleName: 'Swap', beats: null,
    };
  }

  const occs = occurrencesBetween(v, d, d);
  // kind precedence: holiday, school_break, vacation; within kind, earlier rule wins.
  // beats: the highest-ranked other rule covering D excluding the rotation,
  // so collect all candidates in precedence order and take the first two.
  const kinds: Array<Occurrence['kind']> = ['holiday', 'school_break', 'vacation'];
  const candidates: Occurrence[] = [];
  for (const kind of kinds) {
    const inKind = occs.filter((o) => o.kind === kind && coversOcc(o, d)).sort((a, b) => a.order - b.order);
    candidates.push(...inKind);
  }
  const winner = candidates[0] ?? null;
  const beaten = candidates[1] ?? null;
  if (winner) {
    return {
      owner: winner.ownerAt(d),
      ruleId: winner.ruleId,
      kind: winner.kind,
      ruleName: winner.ruleName,
      beats: beaten?.ruleName ?? null,
    };
  }
  const owner = baseOwner(v, d);
  return { owner, ruleId: 'base', kind: 'base', ruleName: 'Base rotation', beats: null };
}

function covers(iv: NightInterval, d: PlainDate): boolean {
  return Temporal.PlainDate.compare(parseDate(iv.first), d) <= 0
    && Temporal.PlainDate.compare(d, parseDate(iv.last)) <= 0;
}

function coversOcc(o: Occurrence, d: PlainDate): boolean {
  return Temporal.PlainDate.compare(o.first, d) <= 0 && Temporal.PlainDate.compare(d, o.last) <= 0;
}

/** The exchange instant for a handover on date D: zone and time come from the
 *  rule owning D, else the rule owning D-1, else the version in effect on D. */
export function handoverFor(
  versions: VersionForNight[],
  swaps: DerivedSwap[],
  d: PlainDate,
  prevOwner: ParentRole | null,
  newOwner: ParentRole,
): Handover | null {
  const vNow = versionInEffect(versions, d);
  if (!vNow) return null;
  const ruleZoneTime = (target: PlainDate): { zone: string; time: PlainTime } | null => {
    const own = deriveNight(versions, swaps, target);
    if (own.ruleId && own.ruleId !== 'base' && own.kind !== 'swap') {
      const occs = occurrencesBetween(versionInEffect(versions, target)!, target, target)
        .filter((o) => o.ruleId === own.ruleId && o.exchangeZone && o.exchangeTime);
      const o = occs[0];
      if (o) return { zone: o.exchangeZone!, time: o.exchangeTime! };
    }
    return null;
  };
  const own = ruleZoneTime(d);
  const prev = ruleZoneTime(addDays(d, -1));
  const fx = Temporal.PlainDateTime.from(vNow.firstExchangeAt.replace(/([+-]\d{2}:\d{2}|Z)$/, '')).toPlainTime();
  const zone = own?.zone ?? prev?.zone ?? vNow.exchangeZone;
  const time = own?.time ?? prev?.time ?? fx;
  const zdt = zonedAt(d, time, zone);
  return {
    date: d.toString(),
    exchangeAt: zdt.toString({ timeZoneName: 'never' }),
    zone,
    from: prevOwner ?? otherOf(newOwner),
    to: newOwner,
  };
}


/** Build the derived year document. */
export function deriveYear(
  versions: VersionForNight[],
  swaps: DerivedSwap[],
  householdId: string,
  year: number,
): YearDoc {
  const start = new Temporal.PlainDate(year, 1, 1);
  const days: YearDay[] = [];
  let planning = 0;
  let other = 0;
  let prevOwner: ParentRole | null = null;
  const total = new Temporal.PlainDate(year, 12, 31).dayOfYear;
  for (let i = 0; i < total; i++) {
    const d = addDays(start, i);
    const own = deriveNight(versions, swaps, d);
    let exchangeAt: string | null = null;
    let exchangeZone: string | null = null;
    if (prevOwner !== null && own.owner !== null && prevOwner !== own.owner) {
      const h = handoverFor(versions, swaps, d, prevOwner, own.owner);
      if (h) {
        exchangeAt = h.exchangeAt;
        exchangeZone = h.zone;
      }
    }
    days.push({
      date: d.toString(),
      owner: own.owner,
      ruleId: own.ruleId,
      kind: own.kind,
      ruleName: own.ruleName,
      beats: own.beats,
      exchangeAt,
      exchangeZone,
    });
    if (own.owner === 'planning') planning += 1;
    if (own.owner === 'other') other += 1;
    if (own.owner !== null) prevOwner = own.owner;
  }
  return { householdId, year, days, nights: { planning, other } };
}
