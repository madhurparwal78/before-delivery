// Holds and claims (brief: Business rules → Holds and claims, Claim idempotency).
import { randomInt } from "node:crypto";
import { COPY, alreadyClaimed, holdExpired, lostRace, notLive } from "../shared/copy";
import { marketTime } from "../shared/format";
import { CITY, type Market, instantText } from "../shared/time";
import { sha256 } from "./auth";
import { type Db, nowSeconds, one, pool, tx } from "./db";
import { settleSales } from "./drops";
import { ApiError, type Json, errorReply, notFound, reply, route, validationFailed } from "./http";
import { marketStatesOf } from "./pieces";
import { publicDrop } from "./public";
import { checkEmail, checkMarket, failed, type Fields } from "./validate";
import { foldName } from "./waitlist";

/** A hold's state as of `nowMs`: an offer is expired from its expiry instant on, whether or not the sweep ran. */
export function holdStatus(stored: string, expiresAt: Date, nowMs: number): string {
  return stored === "offered" && nowMs >= expiresAt.getTime() ? "expired" : stored;
}

interface HoldRow {
  id: string;
  drop_id: string;
  market: Market;
  status: string;
  offered_at: Date;
  expires_at: Date;
  waitlist_member_id: string;
  slug: string;
  drop_name: string;
  drop_status: string;
}

const HOLD_SQL = `SELECT h.*, d.slug, d.name AS drop_name, d.status AS drop_status FROM holds h JOIN drops d ON d.id = h.drop_id WHERE h.token_hash = $1`;

route("GET", "/api/public/holds/{holdToken}", "none", async (ctx) => {
  const hold = await one<HoldRow>(pool, HOLD_SQL, [sha256(ctx.params.holdToken)]);
  if (!hold) throw notFound();
  if (hold.drop_status === "withdrawn") throw new ApiError(410, "drop_withdrawn", COPY.dropWithdrawnPublic);
  return reply(200, {
    dropSlug: hold.slug,
    dropName: hold.drop_name,
    market: hold.market,
    city: CITY[hold.market],
    status: holdStatus(hold.status, hold.expires_at, Date.now()),
    offeredAt: instantText(hold.offered_at.getTime()),
    expiresAt: instantText(hold.expires_at.getTime()),
  });
});

const REFERENCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function reference(): string {
  return `HL-${Array.from({ length: 6 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join("")}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function soldOut(db: Db, dropId: string, market: Market): Promise<ApiError> {
  const last = await one<{ claimed_at: Date }>(db, "SELECT claimed_at FROM claims WHERE drop_id = $1 AND market = $2 ORDER BY claimed_at DESC, id DESC LIMIT 1", [dropId, market]);
  const at = last ? last.claimed_at.getTime() : Math.floor(Date.now() / 1000) * 1000;
  return new ApiError(409, "sold_out", lostRace(marketTime(at)), { claimedAt: instantText(at) });
}

async function insertClaim(db: Db, dropId: string, market: Market, name: string, email: string, holdId: string | null): Promise<{ id: string; reference: string; claimed_at: Date }> {
  const taken = await one(db, "SELECT 1 FROM claims WHERE drop_id = $1 AND market = $2 AND lower(email) = lower($3)", [dropId, market, email]);
  if (taken) throw new ApiError(409, "already_claimed", alreadyClaimed(CITY[market]));
  for (;;) {
    const row = await one<{ id: string; reference: string; claimed_at: Date }>(
      db,
      `INSERT INTO claims (drop_id, market, name, email, reference, hold_id, claimed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reference) DO NOTHING RETURNING id, reference, claimed_at`,
      [dropId, market, name, email, reference(), holdId, nowSeconds()],
    );
    if (row) return row;
  }
}

/** The claim itself, inside the caller's transaction, holding the market row so racing claims queue up. */
async function claim(db: Db, dropId: string, body: Record<string, unknown>): Promise<{ status: number; body: Json }> {
  let market: Market;
  let made: { id: string; reference: string; claimed_at: Date };
  if ("holdToken" in body) {
    const hold = typeof body.holdToken === "string" ? await one<HoldRow>(db, `${HOLD_SQL} AND h.drop_id = $2`, [sha256(body.holdToken), dropId]) : undefined;
    if (!hold) throw notFound();
    market = hold.market;
    await db.query("SELECT 1 FROM drop_markets WHERE drop_id = $1 AND market = $2 FOR UPDATE", [dropId, market]);
    const current = await one<HoldRow>(db, "SELECT * FROM holds WHERE id = $1", [hold.id]);
    const state = holdStatus(current?.status ?? hold.status, hold.expires_at, Date.now());
    if (state === "claimed") throw new ApiError(409, "hold_claimed", COPY.holdClaimed);
    if (state !== "offered") throw new ApiError(409, "hold_expired", holdExpired(marketTime(hold.expires_at.getTime())));
    const member = await one<{ name: string; email: string }>(db, "SELECT name, email FROM waitlist_members WHERE id = $1", [hold.waitlist_member_id]);
    made = await insertClaim(db, dropId, market, member?.name ?? "", member?.email ?? "", hold.id);
    await db.query("UPDATE holds SET status = 'claimed' WHERE id = $1", [hold.id]);
  } else {
    const fields: Fields = {};
    market = checkMarket(body.market, "market", fields);
    const name = foldName(body.name, "name", fields);
    const email = checkEmail(body.email, "email", fields);
    if (!fields.market) {
      await db.query("SELECT 1 FROM drop_markets WHERE drop_id = $1 AND market = $2 FOR UPDATE", [dropId, market]);
      const state = (await marketStatesOf(db, dropId)).find((m) => m.market === market);
      if (!state || state.status === "upcoming") throw new ApiError(409, "market_not_live", notLive(CITY[market]));
      if (state.piecesLeft <= 0) throw await soldOut(db, dropId, market);
      const waiting = await one(
        db,
        "SELECT 1 FROM waitlist_members w WHERE w.drop_id = $1 AND w.market = $2 AND w.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.waitlist_member_id = w.id)",
        [dropId, market],
      );
      if (waiting) throw new ApiError(409, "waitlist_pending", COPY.waitlistPending);
    }
    if (failed(fields)) throw validationFailed(fields);
    made = await insertClaim(db, dropId, market, name, email, null);
  }
  await settleSales(db, dropId);
  const left = (await marketStatesOf(db, dropId)).find((m) => m.market === market)?.piecesLeft ?? 0;
  return {
    status: 201,
    body: { claim: { id: made.id, reference: made.reference, market, claimedAt: instantText(made.claimed_at.getTime()) }, piecesLeft: left },
  };
}

const PRINTABLE = /^[\x20-\x7e]{1,100}$/;

route("POST", "/api/public/drops/{slug}/claims", "json", async (ctx) => {
  const drop = await publicDrop(pool, ctx.params.slug);
  const body = ctx.json();
  const key = ctx.header("idempotency-key");
  if (!key || !PRINTABLE.test(key)) throw new ApiError(400, "idempotency_key_required", COPY.idempotencyKeyRequired);
  const sent = canonical(body);
  const answer = await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`claim:${key}`]);
    const stored = await one<{ body: string; status: number; response: string }>(
      db,
      "SELECT body, status, response FROM claim_replays WHERE idempotency_key = $1 AND created_at > $2",
      [key, new Date(Date.now() - 86_400_000)],
    );
    if (stored) {
      if (stored.body !== sent) throw new ApiError(409, "idempotency_key_reused", COPY.idempotencyKeyReused);
      return { status: stored.status, body: JSON.parse(stored.response) as Json };
    }
    await db.query("SAVEPOINT attempt");
    let result: { status: number; body: Json };
    try {
      result = await claim(db, drop.id, body);
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 422)) throw error;
      await db.query("ROLLBACK TO SAVEPOINT attempt");
      const refused = errorReply(error);
      result = { status: refused.status, body: refused.body ?? null };
    }
    await db.query(
      `INSERT INTO claim_replays (idempotency_key, body, status, response, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO UPDATE SET body = $2, status = $3, response = $4, created_at = $5`,
      [key, sent, result.status, JSON.stringify(result.body), nowSeconds()],
    );
    return result;
  });
  return reply(answer.status, answer.body);
});
