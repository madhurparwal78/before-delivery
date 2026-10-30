import { percentOf } from "./money.js";

// Levelling (brief: Levelling): the one place the subtotal, contingency, levelled total and rank are decided.

export interface Sum {
  label: string;
  amountCents: number;
}

export interface Exclusion {
  id: string;
  label: string;
  priceCents: number | null;
}

export interface BidFigures {
  id: string;
  reference: string;
  finalSubmittedAt: Date;
  baseCents: number;
  provisionalSums: Sum[];
  allowances: Sum[];
  exclusions: Exclusion[];
}

export interface Levelled {
  provisionalSumsCents: number;
  allowancesCents: number;
  pricedExclusionsCents: number;
  unpricedExclusions: number;
  subtotalCents: number;
  contingencyCents: number;
  levelledTotalCents: number;
  rank: number;
}

const total = (sums: Sum[]): number => sums.reduce((sum, item) => sum + item.amountCents, 0);

/** Levels every bid and ranks them: levelled total ascending, then earlier final submission, then lower reference. */
export function level<T extends BidFigures>(bids: T[], contingencyBasisPoints: number): (T & Levelled)[] {
  const levelled = bids.map((bid) => {
    const provisionalSumsCents = total(bid.provisionalSums);
    const allowancesCents = total(bid.allowances);
    const priced = bid.exclusions.flatMap((exclusion) => (exclusion.priceCents === null ? [] : [exclusion.priceCents]));
    const pricedExclusionsCents = priced.reduce((sum, price) => sum + price, 0);
    const subtotalCents = bid.baseCents - provisionalSumsCents + allowancesCents + pricedExclusionsCents;
    const contingencyCents = percentOf(subtotalCents, contingencyBasisPoints);
    return {
      ...bid, provisionalSumsCents, allowancesCents, pricedExclusionsCents, unpricedExclusions: bid.exclusions.length - priced.length,
      subtotalCents, contingencyCents, levelledTotalCents: subtotalCents + contingencyCents, rank: 0,
    };
  });
  const order = [...levelled].sort((a, b) => a.levelledTotalCents - b.levelledTotalCents
    || a.finalSubmittedAt.getTime() - b.finalSubmittedAt.getTime() || (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));
  order.forEach((bid, index) => (bid.rank = index + 1));
  return levelled;
}
