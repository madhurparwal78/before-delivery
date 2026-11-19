// The sale split and the refund allocation, decided here only. Shares are floored to the cent and the
// leftover cents go one each to the largest fractional remainders, ties to creator, remixer, platform.

export type Party = "creator" | "remixer" | "platform";
const PARTY_ORDER: readonly Party[] = ["creator", "remixer", "platform"];

const PLATFORM_PERCENT = 10;
const ROYALTY_PERCENT = 15;

export interface Share {
  party: Party;
  holderId: string | null;
  amount: number;
}

/** Splits `total` cents by numerators over a common denominator so the shares always sum to `total`. */
function largestRemainder(total: number, parts: { party: Party; holderId: string | null; numerator: number }[], denominator: number): Share[] {
  const shares = parts.map((p) => ({ party: p.party, holderId: p.holderId, amount: Math.floor(p.numerator / denominator) }));
  let left = total - shares.reduce((sum, s) => sum + s.amount, 0);
  const order = parts
    .map((p, i) => ({ i, remainder: p.numerator % denominator, rank: PARTY_ORDER.indexOf(p.party) }))
    .sort((a, b) => b.remainder - a.remainder || a.rank - b.rank);
  for (const { i } of order) {
    if (left <= 0) break;
    const share = shares[i];
    if (share) share.amount += 1;
    left -= 1;
  }
  return shares;
}

/** The split of a sale of `pieceCreator`'s piece, a remix when `sourceCreator` (the original's creator) is set. */
export function saleSplitFor(net: number, pieceCreator: string, sourceCreator: string | null): Share[] {
  return sourceCreator ? saleSplit(net, { creator: sourceCreator, remixer: pieceCreator }) : saleSplit(net, { creator: pieceCreator });
}

/**
 * The sale split of the net price: platform 10%; on a remix the original creator's royalty is 15% and the
 * remixer takes the rest, otherwise the creator takes the rest.
 */
function saleSplit(net: number, holders: { creator: string; remixer?: string }): Share[] {
  const platform = net * PLATFORM_PERCENT;
  if (holders.remixer) {
    const royalty = net * ROYALTY_PERCENT;
    return largestRemainder(net, [
      { party: "creator", holderId: holders.creator, numerator: royalty },
      { party: "remixer", holderId: holders.remixer, numerator: net * 100 - royalty - platform },
      { party: "platform", holderId: null, numerator: platform },
    ], 100);
  }
  return largestRemainder(net, [
    { party: "creator", holderId: holders.creator, numerator: net * 100 - platform },
    { party: "platform", holderId: null, numerator: platform },
  ], 100);
}

/**
 * A refund's reversal: the refunded net spread in proportion to the sale rows by the same rule, or,
 * when it completes the refund, exactly each party's remaining amount. Amounts come back positive.
 */
export function refundSplit(refund: number, net: number, sale: Share[], kept: Map<Party, number>, final: boolean): Share[] {
  if (final) return sale.map((s) => ({ party: s.party, holderId: s.holderId, amount: kept.get(s.party) ?? 0 }));
  return largestRemainder(refund, sale.map((s) => ({ party: s.party, holderId: s.holderId, numerator: refund * s.amount })), net);
}
