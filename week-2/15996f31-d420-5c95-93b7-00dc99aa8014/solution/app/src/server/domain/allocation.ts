// Settlement allocation (brief: Business rules → Settlement allocation, the largest-remainder rule)
// and the beekeeper pay display. All amounts are integer cents.

const WHOLE = 10_000;

interface Gross {
  beekeeperId: string;
  grossCents: number;
}

export interface Allocation {
  payableCents: number;
  commissionCents: number;
  /** Beekeeper id → payout, in ascending beekeeper id. */
  payouts: Map<string, number>;
}

export function allocate(grosses: readonly Gross[], commissionBps: number): Allocation {
  const sorted = [...grosses].sort((a, b) => (a.beekeeperId < b.beekeeperId ? -1 : a.beekeeperId > b.beekeeperId ? 1 : 0));
  const payableCents = sorted.reduce((sum, entry) => sum + entry.grossCents, 0);
  // Beekeepers first in ascending id, the broker last: ties on the remainder follow this order.
  const numerators = [...sorted.map((entry) => entry.grossCents * (WHOLE - commissionBps)), payableCents * commissionBps];
  const shares = numerators.map((numerator) => Math.floor(numerator / WHOLE));
  let leftover = payableCents - shares.reduce((sum, share) => sum + share, 0);
  const ranked = numerators
    .map((numerator, index) => ({ index, remainder: numerator % WHOLE }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of ranked) {
    if (leftover === 0) break;
    shares[index] += 1;
    leftover -= 1;
  }
  const payouts = new Map(sorted.map((entry, index) => [entry.beekeeperId, shares[index]]));
  return { payableCents, commissionCents: shares[shares.length - 1], payouts };
}

/** A tier price after commission, rounded half up to a cent; guidance only. */
export function payPerHive(priceCents: number, commissionBps: number): number {
  return Math.floor((2 * priceCents * (WHOLE - commissionBps) + WHOLE) / (2 * WHOLE));
}

interface DropGross {
  dropId: string;
  grossCents: number;
}

/** Splits one beekeeper's share across their drops in proportion to gross; leftover cents to the lowest drop id. */
export function splitShare(shareCents: number, drops: readonly DropGross[]): Map<string, number> {
  const total = drops.reduce((sum, drop) => sum + drop.grossCents, 0);
  const split = new Map(drops.map((drop) => [drop.dropId, total === 0 ? 0 : Math.floor((shareCents * drop.grossCents) / total)]));
  const leftover = shareCents - [...split.values()].reduce((sum, value) => sum + value, 0);
  const lowest = [...split.keys()].sort()[0];
  if (lowest !== undefined) split.set(lowest, (split.get(lowest) ?? 0) + leftover);
  return split;
}
