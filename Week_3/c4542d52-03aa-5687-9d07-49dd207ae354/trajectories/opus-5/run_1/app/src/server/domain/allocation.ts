export interface TenderBid {
  holderId: string;
  shares: number;
  sequence: number;
}

/**
 * Pro rata allocation in whole shares: floor(tendered x cap / total), with the
 * leftover shares given one each to the earliest submissions in sequence order.
 */
export function allocateTender(bids: readonly TenderBid[], shareCap: number): Map<string, number> {
  const allocation = new Map<string, number>();
  const total = bids.reduce((sum, bid) => sum + bid.shares, 0);
  if (total === 0) return allocation;
  if (total <= shareCap) {
    for (const bid of bids) allocation.set(bid.holderId, bid.shares);
    return allocation;
  }
  let assigned = 0;
  for (const bid of bids) {
    const floor = Math.floor((bid.shares * shareCap) / total);
    allocation.set(bid.holderId, floor);
    assigned += floor;
  }
  let leftover = shareCap - assigned;
  const bySequence = [...bids].sort((a, b) => a.sequence - b.sequence);
  for (const bid of bySequence) {
    if (leftover <= 0) break;
    const current = allocation.get(bid.holderId) ?? 0;
    if (current >= bid.shares) continue;
    allocation.set(bid.holderId, current + 1);
    leftover -= 1;
  }
  return allocation;
}
