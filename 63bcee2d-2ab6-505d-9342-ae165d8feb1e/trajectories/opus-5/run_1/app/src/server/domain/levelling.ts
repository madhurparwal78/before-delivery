/** The levelled total formula and the published rank tie-break. */

import { percentOfCents, sumCents } from './money.js';

export interface LevellingInput {
  baseCents: number;
  provisionalSums: readonly { label: string; amountCents: number }[];
  allowances: readonly { label: string; amountCents: number }[];
  exclusions: readonly { id: string; label: string; priceCents: number | null }[];
}

export interface LevellingFigures {
  provisionalSumsCents: number;
  allowancesCents: number;
  pricedExclusionsCents: number;
  unpricedExclusions: number;
  subtotalCents: number;
  contingencyCents: number;
  levelledTotalCents: number;
}

export function levelBid(input: LevellingInput, contingencyPercent: string): LevellingFigures {
  const provisionalSumsCents = sumCents(input.provisionalSums.map((item) => item.amountCents));
  const allowancesCents = sumCents(input.allowances.map((item) => item.amountCents));
  const pricedExclusionsCents = sumCents(
    input.exclusions.map((item) => item.priceCents ?? 0),
  );
  const unpricedExclusions = input.exclusions.filter((item) => item.priceCents === null).length;
  const subtotalCents =
    input.baseCents - provisionalSumsCents + allowancesCents + pricedExclusionsCents;
  const contingencyCents = percentOfCents(subtotalCents, contingencyPercent);
  return {
    provisionalSumsCents,
    allowancesCents,
    pricedExclusionsCents,
    unpricedExclusions,
    subtotalCents,
    contingencyCents,
    levelledTotalCents: subtotalCents + contingencyCents,
  };
}

export interface RankableBid {
  levelledTotalCents: number;
  finalSubmittedAt: string;
  reference: string;
}

/** Levelled total ascending, then the earlier submission, then the lower reference. */
export function compareForRank(left: RankableBid, right: RankableBid): number {
  if (left.levelledTotalCents !== right.levelledTotalCents) {
    return left.levelledTotalCents - right.levelledTotalCents;
  }
  if (left.finalSubmittedAt !== right.finalSubmittedAt) {
    return left.finalSubmittedAt < right.finalSubmittedAt ? -1 : 1;
  }
  return left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0;
}

export function assignRanks<T extends RankableBid>(bids: readonly T[]): (T & { rank: number })[] {
  return [...bids]
    .sort(compareForRank)
    .map((bid, index) => ({ ...bid, rank: index + 1 }));
}
