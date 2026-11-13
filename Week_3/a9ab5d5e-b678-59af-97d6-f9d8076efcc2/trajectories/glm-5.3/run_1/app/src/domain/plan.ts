/** Plan version model, shared wire shape. */

export type ParentRole = 'planning' | 'other';
export type RuleKind = 'holiday' | 'school_break' | 'vacation';
export type DayKind = 'swap' | 'holiday' | 'school_break' | 'vacation' | 'base';
export type BreakSplit = 'halves' | 'whole';

export interface HolidayDateFixed {
  type: 'fixed';
  month: number;
  day: number;
}
export interface HolidayDateNthWeekday {
  type: 'nth_weekday';
  month: number;
  weekday: number; // ISO 1=Monday..7=Sunday
  n: number;       // 1..5 or -1
}
export interface HolidayDateEaster {
  type: 'easter';
}
export type HolidayDate = HolidayDateFixed | HolidayDateNthWeekday | HolidayDateEaster;

export interface RuleBase {
  id: string;
  name: string;
}

export interface HolidayRule extends RuleBase {
  kind: 'holiday';
  date: HolidayDate;
  startOffset: number; // -7..7
  nights: number;      // 1..14
  oddYears: ParentRole;
  evenYears: ParentRole;
}

export interface SchoolBreakRule extends RuleBase {
  kind: 'school_break';
  nights: string; // interval 'YYYY-MM-DD/YYYY-MM-DD'
  split: BreakSplit;
  firstHalfOddYears: ParentRole;
}

export interface VacationRule extends RuleBase {
  kind: 'vacation';
  parent: ParentRole;
  nights: string; // interval
  exchangeZone?: string;
  firstExchangeAt?: string;
}

export type PlanRule = HolidayRule | SchoolBreakRule | VacationRule;

export interface SplitBp {
  planning: number;
  other: number;
}

export interface VersionBody {
  effectiveFrom: string;              // YYYY-MM-DD
  exchangeZone: string;               // IANA
  firstExchangeAt: string;            // RFC 3339 with offset
  base: { pattern: string; anchor: string };
  splitBp: SplitBp;
  maxConsecutiveNights: number | null;
  rules: PlanRule[];
}

export interface PlanVersion extends VersionBody {
  id: string;      // decimal digits
  number: number;  // from 1
  status: 'draft' | 'adopted';
}
