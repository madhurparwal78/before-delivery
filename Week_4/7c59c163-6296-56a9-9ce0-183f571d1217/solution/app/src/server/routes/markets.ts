import { randomUUID } from "node:crypto";
import { type MarketAction } from "../../shared/rules.js";
import { requireRole, signedIn } from "../auth.js";
import { Check } from "../body.js";
import { one, pool, tx } from "../db.js";
import { conflict } from "../errors.js";
import { json, type Ctx, type Route } from "../http.js";
import { maintenanceCheck } from "../liquidation.js";
import { closeIfDue, settle, transition } from "../markets.js";
import { Changes, openStream, publishLater } from "../stream.js";
import { bookOf, marketById, marketsOfVenue, marketView, venueById } from "../views.js";

async function listMarkets(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx));
  return json(200, { markets: (await marketsOfVenue(pool, venueId)).map(marketView) });
}

async function getMarket(ctx: Ctx) {
  const auth = signedIn(ctx);
  const market = await marketById(pool, ctx.params.id ?? "", auth.venueId);
  requireRole(auth);
  return json(200, { ...marketView(market), server_time: new Date().toISOString() });
}

async function getBook(ctx: Ctx) {
  const auth = signedIn(ctx);
  const market = await marketById(pool, ctx.params.id ?? "", auth.venueId);
  requireRole(auth);
  return json(200, await bookOf(pool, market));
}

async function stream(ctx: Ctx) {
  const auth = signedIn(ctx);
  const market = await marketById(pool, ctx.query.get("market_id") ?? "", auth.venueId);
  requireRole(auth);
  await openStream(ctx.res, market, auth.memberId);
  return { status: 200, sent: true };
}

async function venueSummary(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx));
  const venue = await venueById(pool, venueId);
  const summary = await one<{ volume: number; open_interest: number; flagship: string | null }>(
    pool,
    `SELECT (SELECT coalesce(sum(price::bigint * quantity), 0) FROM trades
              WHERE venue_id = $1 AND at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)) AS volume,
            (SELECT id FROM markets WHERE venue_id = $1 AND symbol = $3) AS flagship`,
    [venueId, venue.time_zone, venue.flagship_symbol],
  );
  const markets = await marketsOfVenue(pool, venueId);
  return json(200, {
    volume_cents_today: summary?.volume ?? 0,
    open_interest_contracts: markets.reduce((total, m) => total + m.open_interest, 0),
    flagship_market_id: summary?.flagship ?? null,
  });
}

async function createMarket(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "market_admin");
  const kind = (ctx.body as { kind?: unknown } | undefined)?.kind;
  const check = new Check(ctx.body, kind === "event" ? ["kind", "symbol", "title", "closes_at"] : ["kind", "symbol", "title"]);
  check.oneOf("kind", ["pair", "event"] as const);
  const symbol = check.text("symbol", 2, 12, false);
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) check.fail("symbol", "invalid");
  const title = check.text("title", 1, 120);
  let closesAt: Date | null = null;
  if (kind === "event") {
    const raw = check.body.closes_at;
    const parsed = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) check.fail("closes_at", "invalid");
    else closesAt = parsed;
  }
  if (check.ok) {
    const taken = await one(pool, "SELECT 1 FROM markets WHERE venue_id = $1 AND symbol = $2", [venueId, symbol]);
    if (taken) throw conflict("symbol_taken");
  }
  check.done();
  const id = randomUUID();
  const inserted = await one(
    pool,
    "INSERT INTO markets (id, venue_id, kind, symbol, title, status, closes_at) VALUES ($1, $2, $3, $4, $5, 'listed', $6) ON CONFLICT (venue_id, symbol) DO NOTHING RETURNING id",
    [id, venueId, kind, symbol, title, closesAt],
  );
  if (!inserted) throw conflict("symbol_taken");
  return json(201, marketView(await marketById(pool, id, venueId)));
}

function lifecycle(action: MarketAction) {
  return async (ctx: Ctx) => {
    const auth = signedIn(ctx);
    await marketById(pool, ctx.params.id ?? "", auth.venueId);
    requireRole(auth, "market_admin");
    const changes = new Changes();
    const market = await tx(async (client) => {
      const current = await closeIfDue(client, await marketById(client, ctx.params.id ?? "", auth.venueId, true), changes);
      if (action === "resolve") {
        const check = new Check(ctx.body, ["outcome"]);
        const outcome = check.oneOf("outcome", ["yes", "no"] as const);
        await transition(client, current, action, changes);
        check.done();
        await client.query("UPDATE markets SET outcome = $2 WHERE id = $1", [current.id, outcome]);
      } else {
        await transition(client, current, action, changes);
      }
      return marketById(client, current.id, auth.venueId);
    });
    publishLater(changes);
    if (action === "resolve") setImmediate(() => void settle(market.id).catch((error: unknown) => console.error("settlement:", error)));
    return json(200, marketView(market));
  };
}

async function runLiquidations(ctx: Ctx) {
  const auth = signedIn(ctx);
  const found = await marketById(pool, ctx.params.id ?? "", auth.venueId);
  requireRole(auth, "market_admin");
  if (found.kind !== "pair") throw conflict("not_a_pair");
  const changes = new Changes();
  const result = await tx(async (client) => maintenanceCheck(client, await marketById(client, found.id, auth.venueId, true), changes));
  publishLater(changes);
  return json(200, result);
}

export const marketRoutes: Route[] = [
  { method: "GET", pattern: "/api/markets", auth: "session", key: true, handler: listMarkets },
  { method: "POST", pattern: "/api/markets", auth: "session", handler: createMarket },
  { method: "GET", pattern: "/api/markets/{id}", auth: "session", key: true, handler: getMarket },
  { method: "GET", pattern: "/api/markets/{id}/book", auth: "session", key: true, handler: getBook },
  { method: "POST", pattern: "/api/markets/{id}/open", auth: "session", handler: lifecycle("open") },
  { method: "POST", pattern: "/api/markets/{id}/halt", auth: "session", handler: lifecycle("halt") },
  { method: "POST", pattern: "/api/markets/{id}/resume", auth: "session", handler: lifecycle("resume") },
  { method: "POST", pattern: "/api/markets/{id}/resolve", auth: "session", handler: lifecycle("resolve") },
  { method: "POST", pattern: "/api/markets/{id}/liquidations", auth: "session", handler: runLiquidations },
  { method: "GET", pattern: "/api/stream", auth: "session", handler: stream },
  { method: "GET", pattern: "/api/venue/summary", auth: "session", handler: venueSummary },
];

