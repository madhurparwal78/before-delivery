import { CancellationTier, PlanCode } from '../shared/types';
import { PropertyRow } from './inventory';
import { addDays, localDateTime, parseDate, wallToUtc } from './zone';

export interface PolicyTier {
  days_before: number;
  hour: number;
  refund_pct: number;
}

/** The deadline instant of a policy tier, resolved in the property's zone. */
export function deadlineMs(zone: string, arrival: string, tier: PolicyTier): number {
  const date = addDays(arrival, -tier.days_before);
  const parts = parseDate(date)!;
  return wallToUtc(zone, parts.y, parts.m, parts.d, tier.hour, 0);
}

export function cancellationTiers(property: PropertyRow, arrival: string): CancellationTier[] {
  const tiers = (property.policy ?? []).map((tier) => {
    const ms = deadlineMs(property.zone, arrival, tier);
    return {
      refund_pct: tier.refund_pct,
      deadline_utc: new Date(ms).toISOString(),
      deadline_local: localDateTime(property.zone, ms),
      ms,
    };
  });
  tiers.sort((a, b) => a.ms - b.ms);
  return tiers.map(({ refund_pct, deadline_utc, deadline_local }) => ({ refund_pct, deadline_utc, deadline_local }));
}

export interface RefundStatus {
  kind: 'free' | 'partial' | 'none';
  refund_pct: number;
  until_utc: string | null;
}

/** The refund in force: the tier with the earliest deadline still ahead. */
export function refundStatus(
  property: PropertyRow,
  arrival: string,
  nowMs: number,
  plans: PlanCode[],
): RefundStatus {
  const refundable = plans.some((plan) => plan === 'refundable');
  if (!refundable) return { kind: 'none', refund_pct: 0, until_utc: null };
  for (const tier of cancellationTiers(property, arrival)) {
    if (nowMs < new Date(tier.deadline_utc).getTime()) {
      return {
        kind: tier.refund_pct === 100 ? 'free' : 'partial',
        refund_pct: tier.refund_pct,
        until_utc: tier.deadline_utc,
      };
    }
  }
  return { kind: 'none', refund_pct: 0, until_utc: null };
}

/** The `free` filter and the `Refundable` tag: a 100 percent tier still ahead. */
export function freeCancellationAhead(property: PropertyRow, arrival: string, nowMs: number): boolean {
  return cancellationTiers(property, arrival).some(
    (tier) => tier.refund_pct === 100 && nowMs < new Date(tier.deadline_utc).getTime(),
  );
}
