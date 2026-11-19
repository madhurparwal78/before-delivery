import { equityFor, maintenanceFor, RANGES, type Mode, type Outcome, type Side } from "../../shared/rules.js";
import { requireRole, signedIn } from "../auth.js";
import { Check } from "../body.js";
import { one, pool, rows, tx, UUID } from "../db.js";
import { conflict, notFound } from "../errors.js";
import { json, type Ctx, type Route } from "../http.js";
import { idempotent } from "../idempotency.js";
import { balanceOf } from "../ledger.js";
import { scheduleMaintenance } from "../liquidation.js";
import { closeIfDue } from "../markets.js";
import { Changes, publishLater } from "../stream.js";
import { endOrder, placeOrder, type OrderInput } from "../trading.js";
import { fillView, marketById, orderViews, ownOrder, type FillRow, type OrderRow } from "../views.js";

async function createOrder(ctx: Ctx) {
  const auth = signedIn(ctx);
  return idempotent(ctx, auth.memberId, "orders", null, async (keyError) => {
    const raw = (ctx.body ?? {}) as Record<string, unknown>;
    const marketId = typeof raw.market_id === "string" ? raw.market_id : null;
    const found = marketId !== null ? await marketById(pool, marketId, auth.venueId) : null;
    requireRole(auth, "trader", "builder");
    if (found && found.status !== "trading") throw conflict("market_not_trading", { status: found.status });
    const pair = found?.kind === "pair";
    const check = new Check(ctx.body, pair ? ["market_id", "mode", "side", "price", "quantity"] : ["market_id", "outcome", "price", "quantity"], keyError);
    if (!found) check.fail("market_id", "invalid");
    const input: OrderInput = pair
      ? { mode: check.oneOf<Mode>("mode", ["spot", "margin"]), side: check.oneOf<Side>("side", ["buy", "sell"]), outcome: null, price: 0, quantity: 0 }
      : { mode: null, side: "buy", outcome: check.oneOf<Outcome>("outcome", ["yes", "no"]), price: 0, quantity: 0 };
    const range = pair ? RANGES.pairPrice : RANGES.eventPrice;
    input.price = check.int("price", range.min, range.max);
    input.quantity = check.int("quantity", RANGES.quantity.min, RANGES.quantity.max);
    check.done();
    const changes = new Changes();
    const orderId = await tx(async (client) => {
      const market = await closeIfDue(client, await marketById(client, (found as NonNullable<typeof found>).id, auth.venueId, true), changes);
      if (market.status !== "trading") throw conflict("market_not_trading", { status: market.status });
      return placeOrder(client, market, auth.memberId, input, changes);
    });
    publishLater(changes);
    if (pair && changes.trades.length > 0) scheduleMaintenance((found as NonNullable<typeof found>).id);
    const order = (await one<OrderRow>(pool, "SELECT * FROM orders WHERE id = $1", [orderId])) as OrderRow;
    return json(201, (await orderViews(pool, [order]))[0]);
  });
}

async function listOrders(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "trader", "builder");
  const open = ctx.query.get("status") === "open";
  const marketId = ctx.query.get("market_id");
  if (marketId !== null && !UUID.test(marketId)) return json(200, { orders: [] });
  const orders = await rows<OrderRow>(
    pool,
    `SELECT * FROM orders WHERE member_id = $1 ${open ? "AND status IN ('resting', 'partially_filled')" : ""}
       ${marketId ? "AND market_id = $2" : ""} ORDER BY seq DESC LIMIT 200`,
    marketId ? [auth.memberId, marketId] : [auth.memberId],
  );
  return json(200, { orders: await orderViews(pool, orders) });
}

async function getOrder(ctx: Ctx) {
  const auth = signedIn(ctx);
  const order = await ownOrder(pool, ctx.params.id ?? "", auth.memberId);
  requireRole(auth, "trader", "builder");
  return json(200, (await orderViews(pool, [order]))[0]);
}

async function cancelOrder(ctx: Ctx) {
  const auth = signedIn(ctx);
  const found = await ownOrder(pool, ctx.params.id ?? "", auth.memberId);
  requireRole(auth, "trader", "builder");
  const changes = new Changes();
  await tx(async (client) => {
    await client.query("SELECT 1 FROM markets WHERE id = $1 FOR NO KEY UPDATE", [found.market_id]);
    await endOrder(client, await ownOrder(client, found.id, auth.memberId, true), "cancelled", changes);
  });
  publishLater(changes);
  const order = await ownOrder(pool, found.id, auth.memberId);
  return json(200, (await orderViews(pool, [order]))[0]);
}

async function listFills(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "trader", "builder");
  const marketId = ctx.query.get("market_id");
  if (marketId !== null && !UUID.test(marketId)) return json(200, { fills: [] });
  const fills = await rows<FillRow>(
    pool,
    `SELECT * FROM fills WHERE member_id = $1 ${marketId ? "AND market_id = $2" : ""} ORDER BY seq DESC LIMIT 200`,
    marketId ? [auth.memberId, marketId] : [auth.memberId],
  );
  return json(200, { fills: fills.map(fillView) });
}

async function getFill(ctx: Ctx) {
  const auth = signedIn(ctx);
  const id = ctx.params.id ?? "";
  const fill = UUID.test(id) ? await one<FillRow>(pool, "SELECT * FROM fills WHERE id = $1 AND member_id = $2", [id, auth.memberId]) : undefined;
  if (!fill) throw notFound();
  requireRole(auth, "trader", "builder");
  return json(200, fillView(fill));
}

async function getBalance(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth);
  return json(200, await balanceOf(pool, auth.memberId));
}

async function getPositions(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth);
  const spot = await rows<{ market_id: string; quantity: number; reserved: number }>(
    pool,
    "SELECT market_id, quantity, reserved FROM spot_holdings WHERE member_id = $1 AND (quantity > 0 OR reserved > 0) ORDER BY market_id",
    [auth.memberId],
  );
  const margin = await rows<{
    id: string;
    market_id: string;
    side: "long" | "short";
    quantity: number;
    cost_cents: number;
    collateral_cents: number;
    status: string;
    mark: number | null;
  }>(
    pool,
    `SELECT DISTINCT ON (p.market_id) p.id, p.market_id, p.side, p.quantity, p.cost_cents, p.collateral_cents, p.status, m.last_price AS mark
       FROM margin_positions p JOIN markets m ON m.id = p.market_id
      WHERE p.member_id = $1 ORDER BY p.market_id, p.opened_at DESC`,
    [auth.memberId],
  );
  const event = await rows<{ market_id: string; outcome: string; quantity: number }>(
    pool,
    "SELECT market_id, outcome, quantity FROM event_positions WHERE member_id = $1 AND quantity > 0 ORDER BY market_id, outcome",
    [auth.memberId],
  );
  return json(200, {
    spot,
    margin: margin.map(({ mark, ...p }) => ({
      ...p,
      equity_cents: p.status === "open" && mark !== null ? equityFor(p.side, p.collateral_cents, p.cost_cents, p.quantity, mark) : 0,
      maintenance_cents: p.status === "open" && mark !== null ? maintenanceFor(p.quantity, mark) : 0,
    })),
    event,
  });
}

export const orderRoutes: Route[] = [
  { method: "POST", pattern: "/api/orders", auth: "session", key: true, handler: createOrder },
  { method: "GET", pattern: "/api/orders", auth: "session", key: true, handler: listOrders },
  { method: "GET", pattern: "/api/orders/{id}", auth: "session", key: true, handler: getOrder },
  { method: "DELETE", pattern: "/api/orders/{id}", auth: "session", key: true, handler: cancelOrder },
  { method: "GET", pattern: "/api/fills", auth: "session", key: true, handler: listFills },
  { method: "GET", pattern: "/api/fills/{id}", auth: "session", key: true, handler: getFill },
  { method: "GET", pattern: "/api/balance", auth: "session", key: true, handler: getBalance },
  { method: "GET", pattern: "/api/positions", auth: "session", key: true, handler: getPositions },
];
