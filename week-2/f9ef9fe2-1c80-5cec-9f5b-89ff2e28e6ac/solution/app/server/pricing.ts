import type { Cell, Line, PaidBy, Quote, RateCard, Station, Tier } from "./domain.js";
import { minutesOf } from "./kitchenTime.js";
import { dollars, hoursText, roundHalfUp } from "./money.js";

// The tier walk and the rounding rule (brief: Monthly tiers and prices), decided only here.

function tierOf(quarterCount: number): Tier {
  if (quarterCount < 32) return 1;
  if (quarterCount < 80) return 2;
  if (quarterCount < 120) return 3;
  return 4;
}

export interface Priced {
  quote: Quote;
  /** Pack quarters left after this walk. */
  packLeft: number;
}

/**
 * Prices a cell set for one member: cells ordered by start then loom order, a running count from
 * the month-to-date quarters, the first cells up to the pack balance paid by pack, then lines by
 * station, tier and cash before pack, each cash line rounded half up to a whole cent once.
 */
export function priceCells(
  cells: Cell[],
  stations: Station[],
  card: RateCard,
  month: string,
  monthQuartersBefore: number,
  packBalance: number,
): Priced {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const order = (cell: Cell): number => byId.get(cell.station_id)?.order ?? 0;
  const walk = [...cells].sort((a, b) => minutesOf(a.start) - minutesOf(b.start) || order(a) - order(b));
  const startTier = tierOf(monthQuartersBefore);
  const crossed: number[] = [];
  const groups = new Map<string, { station: Station; tier: Tier; paid_by: PaidBy; quarters: number }>();
  let count = monthQuartersBefore;
  let pack = 0;
  for (const cell of walk) {
    const tier = tierOf(count);
    if (tier > startTier && !crossed.includes(tier)) crossed.push(tier);
    const paid_by: PaidBy = pack < packBalance ? "pack" : "cash";
    if (paid_by === "pack") pack += 1;
    const station = byId.get(cell.station_id);
    if (!station) throw new Error(`Cell on unknown station ${cell.station_id}`);
    const key = `${station.id}|${tier}|${paid_by}`;
    const group = groups.get(key) ?? { station, tier, paid_by, quarters: 0 };
    group.quarters += 1;
    groups.set(key, group);
    count += 1;
  }
  const lines: Line[] = [...groups.values()]
    .sort(
      (a, b) =>
        a.station.order - b.station.order ||
        a.tier - b.tier ||
        Number(a.paid_by === "pack") - Number(b.paid_by === "pack"),
    )
    .map((g) => {
      const rate = (card.tier_rates_cents[g.tier - 1] ?? 0) + (card.station_surcharges_cents[g.station.id] ?? 0);
      return {
        station_id: g.station.id,
        station: g.station.name,
        tier: g.tier,
        paid_by: g.paid_by,
        quarters: g.quarters,
        hours: hoursText(g.quarters),
        hourly_rate_cents: rate,
        amount_cents: g.paid_by === "pack" ? 0 : roundHalfUp(g.quarters * rate, 4),
      };
    });
  const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  return {
    quote: {
      month,
      month_hours_before: hoursText(monthQuartersBefore),
      rate_card_id: card.id,
      lines,
      tier_steps_crossed: crossed,
      pack_quarters: pack,
      quarters: walk.length,
      hours: hoursText(walk.length),
      total_cents: total,
      total: dollars(total),
    },
    packLeft: packBalance - pack,
  };
}
