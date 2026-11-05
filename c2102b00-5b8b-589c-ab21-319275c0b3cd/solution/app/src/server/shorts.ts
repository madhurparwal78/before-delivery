// Short-unit selection: short units are the highest-numbered units not already short, so the
// latest pledges are short first. Each short unit belongs to one pledger and credits its own share.
import { type PledgeRow, unitCost } from "./shares.js";

interface ShortShare {
  pledger: string;
  short_units: number;
  credit_cents: number;
}

/**
 * The pledgers whose units fall in the short range after `alreadyShort` units, for `units` more
 * short units, in pledge order.
 */
export function shortShares(
  pledges: PledgeRow[],
  priceCents: number,
  pack: number,
  alreadyShort: number,
  units: number,
): ShortShare[] {
  const last = pack - alreadyShort;
  const first = last - units + 1;
  const found: ShortShare[] = [];
  let unit = 1;
  for (const p of pledges) {
    const entry: ShortShare = { pledger: p.pledger, short_units: 0, credit_cents: 0 };
    for (let n = unit; n < unit + p.units; n++) {
      if (n >= first && n <= last) {
        entry.short_units++;
        entry.credit_cents += unitCost(priceCents, pack, n);
      }
    }
    unit += p.units;
    if (entry.short_units > 0) found.push(entry);
  }
  return found;
}

/** Every pledger's short units and short credit on a line with `totalShort` short units. */
export function allShortShares(pledges: PledgeRow[], priceCents: number, pack: number, totalShort: number) {
  return new Map(shortShares(pledges, priceCents, pack, 0, totalShort).map((s) => [s.pledger, s]));
}
