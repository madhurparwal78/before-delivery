// The sweep (brief: Services → Postgres). Every copy runs it every second; one advisory lock per pass makes each
// go-live, hold offer, expiry and restock happen once, and mail rows are claimed one by one with SKIP LOCKED.
import { marketTime } from "../shared/format";
import { CITY, MARKETS, type Market, type Wall, parseLocal } from "../shared/time";
import { randomToken, sha256 } from "./auth";
import { config } from "./config";
import { type Db, nowSeconds, rows, tx } from "./db";
import { type DropRow, moveDrop, settleSales } from "./drops";
import { deliverPending, queueMail } from "./mail";
import { marketStatesOf } from "./pieces";
import { occurrence } from "./restocks";
import { storeSeedImages } from "./seed";

async function goLive(db: Db, now: Date): Promise<void> {
  const due = await rows<Pick<DropRow, "id" | "status">>(
    db,
    "SELECT d.id, d.status FROM drops d WHERE d.status = 'scheduled' AND EXISTS (SELECT 1 FROM drop_markets m WHERE m.drop_id = d.id AND m.go_live_at <= $1) FOR UPDATE",
    [now],
  );
  for (const drop of due) {
    await moveDrop(db, drop, "live");
    await settleSales(db, drop.id);
  }
}

/** One hold per confirmed member never offered one, in join order, while the market has open pieces. */
async function offerHolds(db: Db, now: Date): Promise<void> {
  await db.query("UPDATE holds SET status = 'expired' WHERE status = 'offered' AND expires_at <= $1", [now]);
  const live = await rows<Pick<DropRow, "id" | "name" | "hold_seconds">>(db, "SELECT id, name, hold_seconds FROM drops WHERE status = 'live'");
  for (const drop of live) {
    for (const market of await marketStatesOf(db, drop.id, now.getTime())) {
      if (market.status !== "live" || market.piecesLeft <= 0) continue;
      const next = await rows<{ id: string; name: string; email: string }>(
        db,
        `SELECT w.id, w.name, w.email FROM waitlist_members w
         WHERE w.drop_id = $1 AND w.market = $2 AND w.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.waitlist_member_id = w.id)
         ORDER BY w.join_position LIMIT $3`,
        [drop.id, market.market, market.piecesLeft],
      );
      for (const member of next) {
        const token = randomToken();
        const expires = new Date(now.getTime() + drop.hold_seconds * 1000);
        await db.query(
          "INSERT INTO holds (drop_id, market, waitlist_member_id, token_hash, status, offered_at, expires_at) VALUES ($1, $2, $3, $4, 'offered', $5, $6)",
          [drop.id, market.market, member.id, sha256(token), now, expires],
        );
        await queueMail(db, {
          toName: member.name,
          toEmail: member.email,
          subject: `A piece of ${drop.name} is held for you`,
          body: `Hello ${member.name},\n\nA piece of ${drop.name} is held for you in ${CITY[market.market]}.\n\nClaim it here:\n${config.publicUrl}/claim/${token}\n\nThe hold ends ${marketTime(expires.getTime(), market.market)}. After that the piece goes to the next person on the waitlist.\n`,
        });
      }
    }
  }
}

async function restock(db: Db, now: Date): Promise<void> {
  const series = await rows<{ id: string; drop_id: string; first_restock: string; pieces: Record<Market, number>; applied: number }>(
    db,
    "SELECT s.id, s.drop_id, s.first_restock, s.pieces, s.applied FROM restock_series s JOIN drops d ON d.id = s.drop_id WHERE d.status <> 'withdrawn' FOR UPDATE OF s",
  );
  for (const s of series) {
    const first = parseLocal(s.first_restock) as Wall;
    let applied = s.applied;
    while (occurrence(first, applied) <= now.getTime()) {
      for (const market of MARKETS) {
        await db.query("UPDATE drop_markets SET store_pieces = store_pieces + $3 WHERE drop_id = $1 AND market = $2", [s.drop_id, market, s.pieces[market] ?? 0]);
      }
      applied += 1;
    }
    if (applied !== s.applied) {
      await db.query("UPDATE restock_series SET applied = $2 WHERE id = $1", [s.id, applied]);
      await settleSales(db, s.drop_id);
    }
  }
}

async function pass(): Promise<void> {
  await tx(async (db) => {
    const locked = await rows<{ ok: boolean }>(db, "SELECT pg_try_advisory_xact_lock(7001) AS ok");
    if (!locked[0]?.ok) return;
    const now = nowSeconds();
    await goLive(db, now);
    await restock(db, now);
    await offerHolds(db, now);
  });
}

let busy = false;

export function startSweep(): void {
  setInterval(() => {
    if (busy) return;
    busy = true;
    Promise.resolve()
      .then(pass)
      .then(deliverPending)
      .then(storeSeedImages)
      .catch((error: Error) => console.error("sweep:", error.message))
      .finally(() => {
        busy = false;
      });
  }, 1000);
}
