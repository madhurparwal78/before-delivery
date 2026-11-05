// Unit shares: each unit costs the price over the pack, rounded down; the leftover cents go one
// each to the earliest pledged units, so a sealed case's shares sum exactly to its price.

export interface PledgeRow {
  id: number;
  pledger: string;
  units: number;
}

interface Share {
  pledger: string;
  units: number;
  first_unit: number;
  share_cents: number;
}

/** The per-unit base cost and the leftover cents a case's price splits into. */
function split(priceCents: number, pack: number): { base: number; remainder: number } {
  return { base: Math.floor(priceCents / pack), remainder: priceCents % pack };
}

/** The cost in cents of unit number `n` (1-based, in pledge order). */
export function unitCost(priceCents: number, pack: number, n: number): number {
  const { base, remainder } = split(priceCents, pack);
  return n <= remainder ? base + 1 : base;
}

export function sharesOf(pledges: PledgeRow[], priceCents: number, pack: number): Share[] {
  let first = 1;
  return pledges.map((p) => {
    let share = 0;
    for (let n = first; n < first + p.units; n++) share += unitCost(priceCents, pack, n);
    const row = { pledger: p.pledger, units: p.units, first_unit: first, share_cents: share };
    first += p.units;
    return row;
  });
}

export function shareSummary(pledges: PledgeRow[], priceCents: number, pack: number) {
  const { base, remainder } = split(priceCents, pack);
  return {
    price_cents: priceCents,
    pack,
    unit_base_cents: base,
    remainder_cents: remainder,
    shares: sharesOf(pledges, priceCents, pack),
  };
}
