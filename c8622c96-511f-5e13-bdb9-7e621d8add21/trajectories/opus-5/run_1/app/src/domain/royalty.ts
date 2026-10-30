export interface SplitShare {
  handle: string;
  position: number;
  splitBp: number;
}

export interface RoyaltyShare extends SplitShare {
  amountMinor: number;
}

export interface RoyaltySplit {
  commissionMinor: number;
  poolMinor: number;
  shares: RoyaltyShare[];
}

/**
 * Commission is floored; each co-contributor's floored share is topped up with the
 * leftover cents, largest fractional remainder first, ties by credit position.
 */
export function splitRoyalty(amountMinor: number, rateBp: number, credits: SplitShare[]): RoyaltySplit {
  const commissionMinor = Math.floor((amountMinor * rateBp) / 10000);
  const poolMinor = amountMinor - commissionMinor;
  const shares: RoyaltyShare[] = credits.map((credit) => ({
    ...credit,
    amountMinor: Math.floor((poolMinor * credit.splitBp) / 10000),
  }));
  let leftover = poolMinor - shares.reduce((sum, share) => sum + share.amountMinor, 0);
  const byRemainder = [...shares].sort((left, right) => {
    const leftRemainder = (poolMinor * left.splitBp) % 10000;
    const rightRemainder = (poolMinor * right.splitBp) % 10000;
    if (leftRemainder !== rightRemainder) return rightRemainder - leftRemainder;
    return left.position - right.position;
  });
  for (const share of byRemainder) {
    if (leftover <= 0) break;
    share.amountMinor += 1;
    leftover -= 1;
  }
  return { commissionMinor, poolMinor, shares };
}
