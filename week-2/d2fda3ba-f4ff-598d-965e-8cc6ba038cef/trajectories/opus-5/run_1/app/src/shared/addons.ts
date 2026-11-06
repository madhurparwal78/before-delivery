import { addCalendarDays, addSeconds, startOfDayInZone, toIso } from './time';

export type AddonName = 'sync' | 'publish';
export type AddonState = 'none' | 'active' | 'ending' | 'grace' | 'lapsed';

/** What a billing read (live or cached) tells us about one add-on. */
export interface SubscriptionFacts {
  subscribed: boolean;
  /** Billing end date from Kill Bill as YYYY-MM-DD, or null while the subscription runs on. */
  billingEndDate: string | null;
}

export interface AddonDeadlineConfig {
  syncGraceSeconds: number | null;
  publishRetentionSeconds: number | null;
  publishWarningLeadSeconds: number | null;
}

export interface SyncAddon {
  state: AddonState;
  period_end: string | null;
  checked_at: string;
  source: 'killbill' | 'cache';
  writable_until: string | null;
}

export interface PublishAddon {
  state: AddonState;
  period_end: string | null;
  checked_at: string;
  source: 'killbill' | 'cache';
  warning_at: string | null;
  takedown_at: string | null;
}

export function periodEndInstant(billingEndDate: string | null, timeZone: string): Date | null {
  if (!billingEndDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(billingEndDate);
  if (!match) return null;
  return startOfDayInZone(Number(match[1]), Number(match[2]), Number(match[3]), timeZone);
}

export function syncWritableUntil(periodEnd: Date, timeZone: string, config: AddonDeadlineConfig): Date {
  return config.syncGraceSeconds === null
    ? addCalendarDays(periodEnd, 7, timeZone)
    : addSeconds(periodEnd, config.syncGraceSeconds);
}

export function publishTakedownAt(periodEnd: Date, timeZone: string, config: AddonDeadlineConfig): Date {
  return config.publishRetentionSeconds === null
    ? addCalendarDays(periodEnd, 14, timeZone)
    : addSeconds(periodEnd, config.publishRetentionSeconds);
}

export function publishWarningAt(takedownAt: Date, timeZone: string, config: AddonDeadlineConfig): Date {
  return config.publishWarningLeadSeconds === null
    ? addCalendarDays(takedownAt, -3, timeZone)
    : addSeconds(takedownAt, -config.publishWarningLeadSeconds);
}

function stateFor(facts: SubscriptionFacts, periodEnd: Date | null, deadline: Date | null, now: Date): AddonState {
  if (!facts.subscribed) return 'none';
  if (!periodEnd) return 'active';
  if (periodEnd.getTime() > now.getTime()) return 'ending';
  if (deadline && deadline.getTime() > now.getTime()) return 'grace';
  return 'lapsed';
}

export function syncAddon(
  facts: SubscriptionFacts,
  timeZone: string,
  config: AddonDeadlineConfig,
  checkedAt: Date,
  source: 'killbill' | 'cache',
  now: Date,
): SyncAddon {
  const periodEnd = periodEndInstant(facts.billingEndDate, timeZone);
  const writableUntil = periodEnd ? syncWritableUntil(periodEnd, timeZone, config) : null;
  return {
    state: stateFor(facts, periodEnd, writableUntil, now),
    period_end: periodEnd ? toIso(periodEnd) : null,
    checked_at: toIso(checkedAt),
    source,
    writable_until: writableUntil ? toIso(writableUntil) : null,
  };
}

export function publishAddon(
  facts: SubscriptionFacts,
  timeZone: string,
  config: AddonDeadlineConfig,
  checkedAt: Date,
  source: 'killbill' | 'cache',
  now: Date,
): PublishAddon {
  const periodEnd = periodEndInstant(facts.billingEndDate, timeZone);
  const takedownAt = periodEnd ? publishTakedownAt(periodEnd, timeZone, config) : null;
  const warningAt = takedownAt ? publishWarningAt(takedownAt, timeZone, config) : null;
  return {
    state: stateFor(facts, periodEnd, takedownAt, now),
    period_end: periodEnd ? toIso(periodEnd) : null,
    checked_at: toIso(checkedAt),
    source,
    warning_at: warningAt ? toIso(warningAt) : null,
    takedown_at: takedownAt ? toIso(takedownAt) : null,
  };
}

/** Pushes and restores are allowed while Sync has not lapsed. */
export function syncWritable(state: AddonState): boolean {
  return state === 'active' || state === 'ending' || state === 'grace';
}

/** Creating dossiers, preview links and publishes needs Publish active or ending. */
export function publishAllowed(state: AddonState): boolean {
  return state === 'active' || state === 'ending';
}
