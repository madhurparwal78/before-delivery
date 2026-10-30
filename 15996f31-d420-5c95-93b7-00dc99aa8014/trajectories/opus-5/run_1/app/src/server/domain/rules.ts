import type { Tier } from '../../shared/labels';

export interface RuleSetRecord {
  id: string;
  name: string;
  effectiveFrom: string;
  thresholdsTenths: Record<'reduced' | 'standard' | 'bonus', number>;
  pricePerHiveCents: Record<Tier, number>;
  commissionBps: number;
  depositPerHiveCents: number;
}

/** Rounds a non-negative rational to the nearest integer, halves upward. */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** The mean of sampled frames, in tenths, rounded half up to one decimal. */
export function averageFramesTenths(framesTenths: readonly number[]): number | null {
  if (framesTenths.length === 0) return null;
  const sum = framesTenths.reduce((total, value) => total + value, 0);
  return roundHalfUp(sum, framesTenths.length);
}

export function tierFor(averageTenths: number, ruleSet: RuleSetRecord): Tier {
  const { reduced, standard, bonus } = ruleSet.thresholdsTenths;
  if (averageTenths < reduced) return 'none';
  if (averageTenths < standard) return 'reduced';
  if (averageTenths < bonus) return 'standard';
  return 'bonus';
}

export function blockPayableCents(
  hivesDelivered: number,
  tier: Tier | null,
  ruleSet: RuleSetRecord,
): number {
  if (tier === null) return 0;
  return hivesDelivered * ruleSet.pricePerHiveCents[tier];
}

/** One sampled colony per ten delivered hives, rounded up. */
export function samplesRequired(hivesDelivered: number): number {
  return Math.ceil(hivesDelivered / 10);
}

/** A beekeeper's guidance pay for a tier: the tier price less the commission. */
export function payPerHiveCents(tierPriceCents: number, commissionBps: number): number {
  return roundHalfUp(tierPriceCents * (10_000 - commissionBps), 10_000);
}

export function payPerHiveByTier(ruleSet: RuleSetRecord): Record<Tier, number> {
  return {
    none: payPerHiveCents(ruleSet.pricePerHiveCents.none, ruleSet.commissionBps),
    reduced: payPerHiveCents(ruleSet.pricePerHiveCents.reduced, ruleSet.commissionBps),
    standard: payPerHiveCents(ruleSet.pricePerHiveCents.standard, ruleSet.commissionBps),
    bonus: payPerHiveCents(ruleSet.pricePerHiveCents.bonus, ruleSet.commissionBps),
  };
}

export function depositCents(hivesOrdered: number, ruleSet: RuleSetRecord): number {
  return hivesOrdered * ruleSet.depositPerHiveCents;
}

/** The rule set with the latest effective_from on or before the bloom start. */
export function ruleSetForBloomStart(
  ruleSets: readonly RuleSetRecord[],
  bloomStart: string,
): RuleSetRecord | null {
  let chosen: RuleSetRecord | null = null;
  for (const ruleSet of ruleSets) {
    if (ruleSet.effectiveFrom > bloomStart) continue;
    if (chosen === null || ruleSet.effectiveFrom > chosen.effectiveFrom) chosen = ruleSet;
  }
  return chosen;
}
