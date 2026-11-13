import { PlainDate, compareDates, localMinuteOfDay, parseInstant } from './time';

export type ParentRole = 'planning' | 'other';

export function otherRole(role: ParentRole): ParentRole {
  return role === 'planning' ? 'other' : 'planning';
}

export type HolidayDate =
  | { type: 'fixed'; month: number; day: number }
  | { type: 'nth_weekday'; month: number; weekday: number; n: number }
  | { type: 'easter' };

export interface HolidayRule {
  id: string;
  kind: 'holiday';
  name: string;
  date: HolidayDate;
  startOffset: number;
  nights: number;
  oddYears: ParentRole;
  evenYears: ParentRole;
}

export interface SchoolBreakRule {
  id: string;
  kind: 'school_break';
  name: string;
  nights: string;
  split: 'halves' | 'whole';
  firstHalfOddYears: ParentRole;
}

export interface VacationRule {
  id: string;
  kind: 'vacation';
  name: string;
  parent: ParentRole;
  nights: string;
  /** Both or neither: a vacation may carry its own exchange zone and time. */
  exchangeZone?: string;
  firstExchangeAt?: string;
}

export type PlanRule = HolidayRule | SchoolBreakRule | VacationRule;

export interface VersionBody {
  effectiveFrom: PlainDate;
  exchangeZone: string;
  firstExchangeAt: string;
  base: { pattern: string; anchor: PlainDate };
  splitBp: { planning: number; other: number };
  maxConsecutiveNights: number | null;
  rules: PlanRule[];
}

export interface PlanVersion {
  id: string;
  number: number;
  status: 'draft' | 'adopted';
  body: VersionBody;
}

export interface NightInterval {
  start: PlainDate;
  /** Exclusive: the end date's night lies outside. */
  end: PlainDate;
}

export function parseNightInterval(text: string): NightInterval | null {
  const parts = text.split('/');
  if (parts.length !== 2) return null;
  const [start, end] = parts as [string, string];
  return { start, end };
}

export function intervalCovers(interval: NightInterval, date: PlainDate): boolean {
  return compareDates(interval.start, date) <= 0 && compareDates(date, interval.end) < 0;
}

/** The daily exchange wall clock of a version, as minutes after midnight in its zone. */
export function exchangeMinuteOfDay(body: VersionBody): number {
  const instant = parseInstant(body.firstExchangeAt);
  if (instant === null) return 0;
  return localMinuteOfDay(body.exchangeZone, instant);
}

export function vacationExchangeMinuteOfDay(rule: VacationRule & { exchangeZone: string; firstExchangeAt: string }): number {
  const instant = parseInstant(rule.firstExchangeAt);
  if (instant === null) return 0;
  return localMinuteOfDay(rule.exchangeZone, instant);
}

/** The adopted version with the latest effective date on or before `date`; of two on one date, the newer number. */
export function versionForDate(adopted: PlanVersion[], date: PlainDate): PlanVersion | null {
  let found: PlanVersion | null = null;
  for (const version of adopted) {
    if (compareDates(version.body.effectiveFrom, date) > 0) continue;
    const later = found === null || compareDates(version.body.effectiveFrom, found.body.effectiveFrom) > 0;
    const supersedes = found !== null && version.body.effectiveFrom === found.body.effectiveFrom && version.number > found.number;
    if (later || supersedes) found = version;
  }
  return found;
}

export function earliestVersion(adopted: PlanVersion[]): PlanVersion | null {
  let found: PlanVersion | null = null;
  for (const version of adopted) {
    if (!found || compareDates(version.body.effectiveFrom, found.body.effectiveFrom) < 0) found = version;
  }
  return found;
}
