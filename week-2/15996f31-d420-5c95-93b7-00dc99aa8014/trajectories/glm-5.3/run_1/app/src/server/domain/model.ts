export type Role = "broker" | "beekeeper" | "grower";

export interface Actor {
  id: string;
  role: Role;
  name: string;
  business: string | null;
}

export type Tier = "none" | "reduced" | "standard" | "bonus";

export const TIER_LABELS: Record<Tier, string> = {
  none: "None",
  reduced: "Reduced",
  standard: "Standard",
  bonus: "Bonus",
};

export interface RuleSet {
  id: string;
  name: string;
  effective_from: string;
  threshold_reduced: number;
  threshold_standard: number;
  threshold_bonus: number;
  price_none_cents: number;
  price_reduced_cents: number;
  price_standard_cents: number;
  price_bonus_cents: number;
  commission_bps: number;
  deposit_per_hive_cents: number;
}

/** Frames are handled only as integer tenths from storage to response. */
export function tierForAverage(averageTenths: number, rules: Pick<RuleSet, "threshold_reduced" | "threshold_standard" | "threshold_bonus">): Tier {
  if (averageTenths < rules.threshold_reduced) return "none";
  if (averageTenths < rules.threshold_standard) return "reduced";
  if (averageTenths < rules.threshold_bonus) return "standard";
  return "bonus";
}

export function tierPriceCents(tier: Tier, rules: RuleSet): number {
  switch (tier) {
    case "none":
      return rules.price_none_cents;
    case "reduced":
      return rules.price_reduced_cents;
    case "standard":
      return rules.price_standard_cents;
    case "bonus":
      return rules.price_bonus_cents;
  }
}

/** Mean of sample frames (tenths), rounded half up to one decimal (still tenths). */
export function averageFramesTenths(frameTenths: readonly number[]): number | null {
  if (frameTenths.length === 0) return null;
  const sum = frameTenths.reduce((a, b) => a + b, 0);
  return Math.floor(sum / frameTenths.length + 0.5);
}

export function payPerHiveCents(tier: Tier, rules: RuleSet): number {
  const price = tierPriceCents(tier, rules);
  return Math.floor((price * (10000 - rules.commission_bps)) / 10000 + 0.5);
}

export interface Share {
  beekeeperId: string;
  hives: number;
  grossCents: number;
  payoutCents: number;
}

export interface GrossEntry {
  beekeeperId: string;
  hives: number;
  grossCents: number;
}

/**
 * Largest-remainder split of the orchard payable into the broker commission and
 * each beekeeper's share. Exact shares are floored and leftover cents go one
 * each to the largest fractional remainders; ties favour beekeepers in
 * ascending id before the broker. Shares plus commission always sum to P.
 */
export function allocateSettlement(
  payableCents: number,
  commissionBps: number,
  grosses: readonly GrossEntry[],
): { commissionCents: number; shares: Share[] } {
  const parties = grosses
    .slice()
    .sort((a, b) => (a.beekeeperId < b.beekeeperId ? -1 : 1))
    .map((g) => ({ ...g, exact: (g.grossCents * (10000 - commissionBps)) / 10000 }));
  const brokerExact = (payableCents * commissionBps) / 10000;
  const cents = parties.map((party) => Math.floor(party.exact));
  cents.push(Math.floor(brokerExact));
  let leftover = payableCents - cents.reduce((a, b) => a + b, 0);
  const order = parties
    .map((party, index) => ({ index, remainder: party.exact - Math.floor(party.exact), isBroker: false, id: party.beekeeperId }))
    .concat([{ index: parties.length, remainder: brokerExact - Math.floor(brokerExact), isBroker: true, id: "" }])
    .sort((a, b) => {
      if (a.remainder !== b.remainder) return b.remainder - a.remainder;
      if (a.isBroker !== b.isBroker) return a.isBroker ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
  for (const party of order) {
    if (leftover <= 0) break;
    cents[party.index] = (cents[party.index] ?? 0) + 1;
    leftover -= 1;
  }
  const commissionCents = cents[parties.length] ?? 0;
  const shares = parties.map((party, index) => ({
    beekeeperId: party.beekeeperId,
    hives: party.hives,
    grossCents: party.grossCents,
    payoutCents: cents[index] ?? 0,
  }));
  return { commissionCents, shares };
}

/**
 * Split one beekeeper's payout across their drops in proportion to each drop's
 * gross. Leftover cents go to the drop with the lowest id.
 */
export function splitPayoutAcrossDrops(payoutCents: number, drops: readonly { id: string; grossCents: number }[]): Map<string, number> {
  const result = new Map(drops.map((d) => [d.id, 0]));
  if (drops.length === 0) return result;
  const totalGross = drops.reduce((a, d) => a + d.grossCents, 0);
  if (totalGross === 0) {
    if (payoutCents > 0) {
      const first = drops.reduce((min, d) => (d.id < min.id ? d : min), drops[0]!);
      result.set(first.id, payoutCents);
    }
    return result;
  }
  let assigned = 0;
  for (const drop of drops) {
    const cents = Math.floor((drop.grossCents * payoutCents) / totalGross);
    result.set(drop.id, cents);
    assigned += cents;
  }
  let leftover = payoutCents - assigned;
  const byId = drops.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const drop of byId) {
    if (leftover <= 0) break;
    result.set(drop.id, (result.get(drop.id) ?? 0) + 1);
    leftover -= 1;
  }
  return result;
}
