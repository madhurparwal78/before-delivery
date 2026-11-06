// Pieces left and market status (brief: Business rules → Pieces left; Drop states). Computed from Postgres on
// every read so every surface and every running copy agrees.
import { CITY, MARKETS, type Market, instantText } from "../shared/time";
import { type Db, rows } from "./db";

export type MarketStatus = "upcoming" | "live" | "sold_out";

export interface MarketState {
  market: Market;
  city: string;
  goLiveAt: string | null;
  goLiveMs: number | null;
  storePieces: number;
  claimed: number;
  held: number;
  piecesLeft: number;
  status: MarketStatus;
}

function marketStatus(goLiveMs: number | null, storePieces: number, claimed: number, nowMs: number): MarketStatus {
  if (goLiveMs === null || nowMs < goLiveMs) return "upcoming";
  return claimed >= storePieces ? "sold_out" : "live";
}

/** Every market of each drop, in the published market order. */
export async function marketStates(db: Db, dropIds: string[], nowMs = Date.now()): Promise<Map<string, MarketState[]>> {
  const found = await rows<{ drop_id: string; market: Market; store_pieces: number; go_live_at: Date | null; claimed: number; held: number }>(
    db,
    `SELECT dm.drop_id, dm.market, dm.store_pieces, dm.go_live_at,
       (SELECT count(*)::int FROM claims c WHERE c.drop_id = dm.drop_id AND c.market = dm.market) AS claimed,
       (SELECT count(*)::int FROM holds h WHERE h.drop_id = dm.drop_id AND h.market = dm.market
          AND h.status = 'offered' AND h.expires_at > $2) AS held
     FROM drop_markets dm WHERE dm.drop_id = ANY($1::uuid[])`,
    [dropIds, new Date(nowMs)],
  );
  const result = new Map<string, MarketState[]>();
  for (const id of dropIds) result.set(id, []);
  for (const market of MARKETS) {
    for (const r of found.filter((f) => f.market === market)) {
      const goLiveMs = r.go_live_at ? r.go_live_at.getTime() : null;
      result.get(r.drop_id)?.push({
        market,
        city: CITY[market],
        goLiveAt: goLiveMs === null ? null : instantText(goLiveMs),
        goLiveMs,
        storePieces: r.store_pieces,
        claimed: r.claimed,
        held: r.held,
        piecesLeft: Math.max(0, r.store_pieces - r.claimed - r.held),
        status: marketStatus(goLiveMs, r.store_pieces, r.claimed, nowMs),
      });
    }
  }
  return result;
}

export async function marketStatesOf(db: Db, dropId: string, nowMs = Date.now()): Promise<MarketState[]> {
  return (await marketStates(db, [dropId], nowMs)).get(dropId) ?? [];
}
