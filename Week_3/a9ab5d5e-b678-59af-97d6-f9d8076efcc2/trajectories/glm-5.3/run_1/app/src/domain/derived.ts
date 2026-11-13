/** Accepted or settled swap, as the derivation sees it. */
import type { NightInterval } from '../lib/time';

export interface DerivedSwap {
  id: string;
  /** interval given away: nights */
  nights: NightInterval;
  /** interval returned to the giver: makeupNights */
  makeupNights: NightInterval | null;
  toParent: 'planning' | 'other';
  createdBy: 'planning' | 'other';
  /** state only accepted or settled appear here */
  settledAtHandover: boolean;
}

export interface DayOwner {
  owner: 'planning' | 'other' | null;
  ruleId: string | null;
  kind: 'swap' | 'holiday' | 'school_break' | 'vacation' | 'base' | null;
  ruleName: string | null;
  beats: string | null;
}

export interface Handover {
  date: string;         // YYYY-MM-DD
  exchangeAt: string;   // RFC 3339 output form
  zone: string;         // IANA
  from: 'planning' | 'other';
  to: 'planning' | 'other';
}

export interface YearDay extends DayOwner {
  date: string;
  exchangeAt: string | null;
  exchangeZone: string | null;
}

export interface YearDoc {
  householdId: string;
  year: number;
  days: YearDay[];
  nights: { planning: number; other: number };
}

export interface VersionForNight {
  effectiveFrom: string;
  exchangeZone: string;
  firstExchangeAt: string;
  pattern: string;
  anchor: string;
  maxConsecutiveNights: number | null;
  rules: import('./plan').PlanRule[];
}
