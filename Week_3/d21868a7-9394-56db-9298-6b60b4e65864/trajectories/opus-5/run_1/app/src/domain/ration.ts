import { divFloor, type Ml, ZERO } from './decimal.ts';

/** A requested order that a ration may schedule. */
export interface RationCandidate {
  orderNumber: string;
  growerId: number;
  requestedMl: Ml;
  volumeMl: Ml;
  turnoutMaxVolumeMl: Ml;
  growerRemainingMl: Ml;
}

export interface RationShare {
  orderNumber: string;
  demandMl: Ml;
  shareMl: Ml;
}

/**
 * The proportional ration. Candidates arrive in order-number order, each with
 * at most one candidate per turnout. Shares are demand x remaining / total
 * demand, rounded down to 0.001, with the leftover thousandths handed out by
 * largest discarded remainder so the shares sum to exactly the remaining ML.
 */
export function rationShares(candidates: readonly RationCandidate[], remainingMl: Ml): RationShare[] {
  const takenByGrower = new Map<number, Ml>();
  const demands: RationShare[] = candidates.map((candidate) => {
    const alreadyTaken = takenByGrower.get(candidate.growerId) ?? ZERO;
    const allowance = candidate.growerRemainingMl - alreadyTaken;
    let demand = candidate.volumeMl;
    if (candidate.turnoutMaxVolumeMl < demand) demand = candidate.turnoutMaxVolumeMl;
    if (allowance < demand) demand = allowance;
    if (demand < ZERO) demand = ZERO;
    takenByGrower.set(candidate.growerId, alreadyTaken + demand);
    return { orderNumber: candidate.orderNumber, demandMl: demand, shareMl: ZERO };
  });

  const total = demands.reduce<Ml>((sum, entry) => sum + entry.demandMl, ZERO);
  if (total <= remainingMl) {
    return demands.map((entry) => ({ ...entry, shareMl: entry.demandMl }));
  }

  const shares = demands.map((entry) => {
    const numerator = entry.demandMl * remainingMl;
    const floored = divFloor(numerator, total);
    return { entry, floored, remainder: numerator - floored * total };
  });

  let leftover = remainingMl - shares.reduce<Ml>((sum, share) => sum + share.floored, ZERO);
  const byRemainder = [...shares.keys()].sort((a, b) => {
    const left = shares[a] as (typeof shares)[number];
    const right = shares[b] as (typeof shares)[number];
    if (left.remainder !== right.remainder) return right.remainder > left.remainder ? 1 : -1;
    return a - b;
  });
  const bonus = new Set<number>();
  for (const index of byRemainder) {
    if (leftover <= ZERO) break;
    bonus.add(index);
    leftover -= 1n;
  }

  return shares.map((share, index) => ({
    orderNumber: share.entry.orderNumber,
    demandMl: share.entry.demandMl,
    shareMl: share.floored + (bonus.has(index) ? 1n : 0n),
  }));
}
