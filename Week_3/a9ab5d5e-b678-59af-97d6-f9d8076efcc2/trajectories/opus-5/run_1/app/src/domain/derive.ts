import {
  NightInterval,
  ParentRole,
  PlanVersion,
  VacationRule,
  earliestVersion,
  exchangeMinuteOfDay,
  intervalCovers,
  otherRole,
  parseNightInterval,
  vacationExchangeMinuteOfDay,
  versionForDate,
} from './plan';
import {
  PlainDate,
  addDays,
  compareDates,
  dateYear,
  easterSunday,
  epochDay,
  formatInstant,
  localDate,
  nthWeekdayOfMonth,
  toDateString,
  wallClockToInstant,
} from './time';

export type NightKind = 'swap' | 'holiday' | 'school_break' | 'vacation' | 'base';

export interface AppliedSwap {
  id: string;
  nights: NightInterval;
  makeupNights: NightInterval | null;
  toParent: ParentRole;
}

export interface ExchangeSetting {
  zone: string;
  minuteOfDay: number;
}

export interface DerivedNight {
  date: PlainDate;
  owner: ParentRole | null;
  ruleId: string | null;
  kind: NightKind | null;
  ruleName: string | null;
  beats: string | null;
  /** Set when the winning rule carries its own exchange zone and time. */
  exchange: ExchangeSetting | null;
}

interface Candidate {
  rank: number;
  order: number;
  owner: ParentRole;
  ruleId: string;
  kind: NightKind;
  ruleName: string;
  exchange: ExchangeSetting | null;
}

const kindRank: Record<NightKind, number> = { swap: 0, holiday: 1, school_break: 2, vacation: 3, base: 4 };

export interface Handover {
  date: PlainDate;
  epochMs: number;
  zone: string;
  at: string;
  from: ParentRole | null;
  to: ParentRole | null;
}

/** The one place a night's owner, its winning rule and its handover instant are decided. */
export class Deriver {
  private readonly nights = new Map<PlainDate, DerivedNight>();
  private readonly occurrences = new Map<string, NightInterval | null>();

  constructor(
    private readonly adopted: PlanVersion[],
    private readonly swaps: AppliedSwap[],
  ) {}

  night(date: PlainDate): DerivedNight {
    const cached = this.nights.get(date);
    if (cached) return cached;
    const derived = this.computeNight(date);
    this.nights.set(date, derived);
    return derived;
  }

  owner(date: PlainDate): ParentRole | null {
    return this.night(date).owner;
  }

  range(from: PlainDate, to: PlainDate): DerivedNight[] {
    const out: DerivedNight[] = [];
    for (let date = from; compareDates(date, to) <= 0; date = addDays(date, 1)) out.push(this.night(date));
    return out;
  }

  private computeNight(date: PlainDate): DerivedNight {
    const version = versionForDate(this.adopted, date);
    if (!version) {
      return { date, owner: null, ruleId: null, kind: null, ruleName: null, beats: null, exchange: null };
    }
    const candidates: Candidate[] = [];
    for (const swap of this.swaps) {
      if (intervalCovers(swap.nights, date)) {
        candidates.push({
          rank: kindRank.swap,
          order: 0,
          owner: swap.toParent,
          ruleId: `swap:${swap.id}`,
          kind: 'swap',
          ruleName: 'Swap',
          exchange: null,
        });
      } else if (swap.makeupNights && intervalCovers(swap.makeupNights, date)) {
        candidates.push({
          rank: kindRank.swap,
          order: 0,
          owner: otherRole(swap.toParent),
          ruleId: `swap:${swap.id}`,
          kind: 'swap',
          ruleName: 'Swap',
          exchange: null,
        });
      }
    }
    version.body.rules.forEach((rule, index) => {
      if (rule.kind === 'holiday') {
        for (const year of [dateYear(date) - 1, dateYear(date), dateYear(date) + 1]) {
          const occurrence = this.holidayOccurrence(version.id, rule.id, year, rule);
          if (occurrence && intervalCovers(occurrence, date)) {
            candidates.push({
              rank: kindRank.holiday,
              order: index,
              owner: year % 2 === 0 ? rule.evenYears : rule.oddYears,
              ruleId: rule.id,
              kind: 'holiday',
              ruleName: rule.name,
              exchange: null,
            });
            break;
          }
        }
        return;
      }
      if (rule.kind === 'school_break') {
        const interval = parseNightInterval(rule.nights);
        if (!interval || !intervalCovers(interval, date)) return;
        const oddYear = dateYear(interval.start) % 2 === 1;
        const firstParent = oddYear ? rule.firstHalfOddYears : otherRole(rule.firstHalfOddYears);
        let owner = firstParent;
        if (rule.split === 'halves') {
          const total = epochDay(interval.end) - epochDay(interval.start);
          const firstHalf = Math.ceil(total / 2);
          const index0 = epochDay(date) - epochDay(interval.start);
          owner = index0 < firstHalf ? firstParent : otherRole(firstParent);
        }
        candidates.push({
          rank: kindRank.school_break,
          order: index,
          owner,
          ruleId: rule.id,
          kind: 'school_break',
          ruleName: rule.name,
          exchange: null,
        });
        return;
      }
      const interval = parseNightInterval(rule.nights);
      if (!interval || !intervalCovers(interval, date)) return;
      candidates.push({
        rank: kindRank.vacation,
        order: index,
        owner: rule.parent,
        ruleId: rule.id,
        kind: 'vacation',
        ruleName: rule.name,
        exchange: vacationExchange(rule),
      });
    });
    candidates.push({
      rank: kindRank.base,
      order: 0,
      owner: baseRotationOwner(version, date),
      ruleId: 'base',
      kind: 'base',
      ruleName: 'Base rotation',
      exchange: null,
    });
    candidates.sort((a, b) => a.rank - b.rank || a.order - b.order);
    const winner = candidates[0] as Candidate;
    const beaten = candidates.find((candidate) => candidate !== winner && candidate.kind !== 'base');
    return {
      date,
      owner: winner.owner,
      ruleId: winner.ruleId,
      kind: winner.kind,
      ruleName: winner.ruleName,
      beats: beaten ? beaten.ruleName : null,
      exchange: winner.exchange,
    };
  }

  private holidayOccurrence(
    versionId: string,
    ruleId: string,
    year: number,
    rule: Extract<PlanVersion['body']['rules'][number], { kind: 'holiday' }>,
  ): NightInterval | null {
    const key = `${versionId}|${ruleId}|${year}`;
    if (this.occurrences.has(key)) return this.occurrences.get(key) ?? null;
    let anchor: PlainDate | null;
    if (rule.date.type === 'fixed') anchor = toDateString(year, rule.date.month, rule.date.day);
    else if (rule.date.type === 'easter') anchor = easterSunday(year);
    else anchor = nthWeekdayOfMonth(year, rule.date.month, rule.date.weekday, rule.date.n);
    const interval = anchor
      ? { start: addDays(anchor, rule.startOffset), end: addDays(anchor, rule.startOffset + rule.nights) }
      : null;
    this.occurrences.set(key, interval);
    return interval;
  }

  /** A handover falls on D when D and D − 1 have different owners. */
  handoverOn(date: PlainDate): Handover | null {
    const today = this.night(date);
    const yesterday = this.night(addDays(date, -1));
    if (today.owner === yesterday.owner) return null;
    const setting = this.exchangeSettingFor(date, today, yesterday);
    if (!setting) return null;
    const { epochMs } = wallClockToInstant(setting.zone, date, setting.minuteOfDay);
    return {
      date,
      epochMs,
      zone: setting.zone,
      at: formatInstant(setting.zone, epochMs),
      from: yesterday.owner,
      to: today.owner,
    };
  }

  private exchangeSettingFor(date: PlainDate, today: DerivedNight, yesterday: DerivedNight): ExchangeSetting | null {
    if (today.exchange) return today.exchange;
    if (yesterday.exchange) return yesterday.exchange;
    const version = versionForDate(this.adopted, date);
    if (!version) return null;
    return { zone: version.body.exchangeZone, minuteOfDay: exchangeMinuteOfDay(version.body) };
  }

  /** The start instant of custody day D, ignoring vacation exceptions. */
  custodyDayStart(date: PlainDate): number | null {
    const version = versionForDate(this.adopted, date) ?? earliestVersion(this.adopted);
    if (!version) return null;
    return wallClockToInstant(version.body.exchangeZone, date, exchangeMinuteOfDay(version.body)).epochMs;
  }

  custodyDayFor(epochMs: number): PlainDate | null {
    const reference = earliestVersion(this.adopted);
    if (!reference) return null;
    const guess = localDate(reference.body.exchangeZone, epochMs);
    for (let shift = -2; shift <= 2; shift += 1) {
      const candidate = addDays(guess, shift);
      const start = this.custodyDayStart(candidate);
      const next = this.custodyDayStart(addDays(candidate, 1));
      if (start === null || next === null) continue;
      if (start <= epochMs && epochMs < next) return candidate;
    }
    return guess;
  }

  /** The length of the same-owner run containing `date`, measured across year and version boundaries. */
  runLengthAt(date: PlainDate): number {
    const owner = this.owner(date);
    if (owner === null) return 0;
    let length = 1;
    for (let shift = 1; shift <= 200; shift += 1) {
      if (this.owner(addDays(date, -shift)) !== owner) break;
      length += 1;
    }
    for (let shift = 1; shift <= 200; shift += 1) {
      if (this.owner(addDays(date, shift)) !== owner) break;
      length += 1;
    }
    return length;
  }

  maxConsecutiveNightsOn(date: PlainDate): number | null {
    const version = versionForDate(this.adopted, date);
    return version ? version.body.maxConsecutiveNights : null;
  }
}

function vacationExchange(rule: VacationRule): ExchangeSetting {
  return { zone: rule.exchangeZone, minuteOfDay: vacationExchangeMinuteOfDay(rule) };
}

function baseRotationOwner(version: PlanVersion, date: PlainDate): ParentRole {
  const pattern = version.body.base.pattern;
  const length = pattern.length;
  const offset = epochDay(date) - epochDay(version.body.base.anchor);
  const index = ((offset % length) + length) % length;
  return pattern[index] === 'P' ? 'planning' : 'other';
}

export function intervalDates(interval: NightInterval): PlainDate[] {
  const out: PlainDate[] = [];
  for (let date = interval.start; compareDates(date, interval.end) < 0; date = addDays(date, 1)) out.push(date);
  return out;
}
