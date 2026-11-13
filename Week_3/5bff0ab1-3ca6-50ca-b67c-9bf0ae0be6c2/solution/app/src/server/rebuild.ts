import type { FinishId, HubId, ModelId } from "../shared/catalogue.js";
import { one, q, type Db } from "./db.js";
import { ledger } from "./ledger.js";
import { holdScore } from "./rules.js";
import { HELD_SQL } from "./views.js";

/** Rebuilds ledger keys from what Postgres holds: the one reader of that truth, used by a claim that finds a key gone and by the sweep. */

export async function rebuildUnit(c: Db | undefined, hub: HubId, model: ModelId, finish: FinishId): Promise<void> {
  const onHand = (await one<{ on_hand: number }>("SELECT on_hand FROM stock WHERE hub=$1 AND model=$2 AND finish=$3", [hub, model, finish], c))?.on_hand ?? 0;
  const holds = await q<{ ref: string; state: string; expires_ms: number | null }>(
    `SELECT l.ref, l.state, l.expires_ms FROM locks l WHERE l.hub=$1 AND l.model=$2 AND l.finish=$3 AND ${HELD_SQL}`,
    [hub, model, finish],
    c,
  );
  await ledger.rebuildUnit(hub, model, finish, onHand, holds.map((h) => ({ ref: h.ref, score: holdScore(h.state, h.expires_ms) })));
}

/** The seeded earlier sales that already hold places on a day. */
export const earlierSaleRefs = (n: number): string[] => Array.from({ length: n }, (_, i) => `earlier-sale-${i + 1}`);

export async function rebuildPlaces(c: Db | undefined, hub: HubId, date: string): Promise<void> {
  const earlier = (await one<{ n: number }>("SELECT n FROM earlier_sales WHERE hub=$1 AND date=$2", [hub, date], c))?.n ?? 0;
  const sold = await q<{ ref: string }>("SELECT ref FROM locks WHERE hub=$1 AND delivery_date=$2 AND state IN ('delivery_set','delivered')", [hub, date], c);
  await ledger.rebuildPlaces(hub, date, [...earlierSaleRefs(earlier), ...sold.map((s) => s.ref)]);
}
