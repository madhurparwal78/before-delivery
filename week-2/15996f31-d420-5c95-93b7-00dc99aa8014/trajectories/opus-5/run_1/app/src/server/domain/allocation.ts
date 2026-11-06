export interface PartyGross {
  beekeeperId: string;
  grossCents: number;
}

export interface AllocatedShare {
  beekeeperId: string;
  payoutCents: number;
}

export interface Allocation {
  commissionCents: number;
  shares: AllocatedShare[];
}

interface Candidate {
  beekeeperId: string | null;
  floorCents: number;
  remainder: number;
}

const BASIS = 10_000;

/**
 * The published largest-remainder split of the orchard payable into the broker
 * commission and each beekeeper's share, in whole cents summing exactly to the
 * payable. Ties go to beekeepers in ascending id before the broker.
 */
export function allocateSettlement(
  payableCents: number,
  commissionBps: number,
  grosses: readonly PartyGross[],
): Allocation {
  const ordered = [...grosses].sort((left, right) =>
    left.beekeeperId < right.beekeeperId ? -1 : left.beekeeperId > right.beekeeperId ? 1 : 0,
  );

  const candidates: Candidate[] = [
    {
      beekeeperId: null,
      floorCents: Math.floor((payableCents * commissionBps) / BASIS),
      remainder: (payableCents * commissionBps) % BASIS,
    },
    ...ordered.map((party) => ({
      beekeeperId: party.beekeeperId,
      floorCents: Math.floor((party.grossCents * (BASIS - commissionBps)) / BASIS),
      remainder: (party.grossCents * (BASIS - commissionBps)) % BASIS,
    })),
  ];

  const assigned = candidates.reduce((total, candidate) => total + candidate.floorCents, 0);
  let leftover = payableCents - assigned;

  const byRemainder = [...candidates].sort((left, right) => {
    if (right.remainder !== left.remainder) return right.remainder - left.remainder;
    if (left.beekeeperId === null) return 1;
    if (right.beekeeperId === null) return -1;
    return left.beekeeperId < right.beekeeperId ? -1 : 1;
  });

  const bonusCents = new Map<string | null, number>();
  for (const candidate of byRemainder) {
    if (leftover <= 0) break;
    bonusCents.set(candidate.beekeeperId, 1);
    leftover -= 1;
  }

  const commission = candidates[0] as Candidate;
  return {
    commissionCents: commission.floorCents + (bonusCents.get(null) ?? 0),
    shares: candidates.slice(1).map((candidate) => ({
      beekeeperId: candidate.beekeeperId as string,
      payoutCents: candidate.floorCents + (bonusCents.get(candidate.beekeeperId) ?? 0),
    })),
  };
}

/**
 * A beekeeper's share divided across their drops in proportion to each drop's
 * gross; any leftover cent goes to their drop with the lowest id.
 */
export function splitShareAcrossDrops(
  payoutCents: number,
  drops: ReadonlyArray<{ dropId: string; grossCents: number }>,
): Map<string, number> {
  const byId = [...drops].sort((left, right) => (left.dropId < right.dropId ? -1 : 1));
  const totalGross = byId.reduce((total, drop) => total + drop.grossCents, 0);
  const result = new Map<string, number>();
  if (byId.length === 0) return result;
  if (totalGross === 0) {
    for (const drop of byId) result.set(drop.dropId, 0);
    const first = byId[0] as { dropId: string };
    result.set(first.dropId, payoutCents);
    return result;
  }
  let assigned = 0;
  for (const drop of byId) {
    const amount = Math.floor((payoutCents * drop.grossCents) / totalGross);
    result.set(drop.dropId, amount);
    assigned += amount;
  }
  const first = byId[0] as { dropId: string };
  result.set(first.dropId, (result.get(first.dropId) as number) + (payoutCents - assigned));
  return result;
}
