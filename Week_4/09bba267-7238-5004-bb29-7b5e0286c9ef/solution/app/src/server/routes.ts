// The API's endpoints, in the brief's check order: stored idempotent response, owner session, unknown
// resource, state, validation, then Kill Bill.
import { exchangeTicket, refundTickets } from "./changes.js";
import { checkout } from "./checkout.js";
import { pool } from "./db.js";
import { clearCookie, fail, OWNER_COOKIE, setCookie, type Context, type Reply } from "./http.js";
import { holdSeats, releaseSeat } from "./holds.js";
import { keyed, validKey } from "./idempotency.js";
import { outbox, publish, requireOwner, signIn, signOut } from "./owner.js";
import { acceptOffer, declineOffer, joinWaitlist } from "./waitlist.js";
import {
  buyerOrder, cartOf, entriesOf, offerByToken, ordersWhere, ownerPerformances, performanceRow, performances, seatsOf,
} from "./views.js";

type Handler = (ctx: Context, params: string[]) => Promise<Reply>;

const ok = (body: unknown, status = 200): Reply => ({ status, body });

async function knownPerformance(id: string): Promise<void> {
  if (!(await performanceRow(pool, id))) throw fail(404, "not_found");
}

const keyedRun = (ctx: Context, scope: string, run: (keyValid: boolean) => Promise<Reply>): Promise<Reply> =>
  keyed(scope, ctx.idempotencyKey, ctx.method, ctx.path, ctx.body, () => run(validKey(ctx.idempotencyKey)));

const owned = (handler: Handler): Handler => async (ctx, params) => {
  await requireOwner(ctx.ownerToken);
  return handler(ctx, params);
};

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/performances$/, async (ctx) => ok({ performances: await performances(pool, ctx.now) })],
  ["GET", /^\/api\/performances\/([^/]+)$/, async (ctx, [id]) => {
    const [show] = await performances(pool, ctx.now, id);
    if (!show) throw fail(404, "not_found");
    return ok(show);
  }],
  ["GET", /^\/api\/performances\/([^/]+)\/seats$/, async (ctx, [id]) => {
    await knownPerformance(id);
    return ok({ seats: await seatsOf(pool, id, ctx.buyerId) });
  }],
  ["GET", /^\/api\/performances\/([^/]+)\/cart$/, async (ctx, [id]) => {
    await knownPerformance(id);
    return ok(await cartOf(pool, ctx.buyerId, id, ctx.now));
  }],
  ["POST", /^\/api\/performances\/([^/]+)\/holds$/, async (ctx, [id]) => ok(await holdSeats(ctx.buyerId, id, ctx.body, ctx.now))],
  ["DELETE", /^\/api\/performances\/([^/]+)\/holds\/([^/]+)$/, async (ctx, [id, seatId]) => {
    await knownPerformance(id);
    return ok({ cart: await releaseSeat(ctx.buyerId, id, seatId, ctx.now) });
  }],
  ["POST", /^\/api\/performances\/([^/]+)\/checkout$/, (ctx, [id]) => keyedRun(ctx, `buyer:${ctx.buyerId}`, async (keyValid) =>
    ok({ order: await checkout(ctx.buyerId, id, ctx.body, keyValid, ctx.now) }, 201))],
  ["POST", /^\/api\/performances\/([^/]+)\/tiers\/([^/]+)\/waitlist$/, async (ctx, [id, tierId]) =>
    ok({ entry: await joinWaitlist(ctx.buyerId, id, tierId, ctx.body, ctx.now) }, 201)],
  ["GET", /^\/api\/orders$/, async (ctx) =>
    ok({ orders: (await ordersWhere(pool, "o.buyer_id = $1 AND o.status <> 'cancelled'", [ctx.buyerId])).map(buyerOrder) })],
  ["GET", /^\/api\/orders\/([^/]+)$/, async (ctx, [id]) => {
    const [order] = await ordersWhere(pool, "o.id = $1 AND o.buyer_id = $2", [id, ctx.buyerId]);
    if (!order) throw fail(404, "not_found");
    return ok(buyerOrder(order));
  }],
  ["POST", /^\/api\/tickets\/([^/]+)\/exchange$/, (ctx, [id]) => keyedRun(ctx, `buyer:${ctx.buyerId}`, async (keyValid) =>
    ok(await exchangeTicket(ctx.buyerId, id, ctx.body, keyValid, ctx.now)))],
  ["POST", /^\/api\/orders\/([^/]+)\/refunds$/, (ctx, [id]) => keyedRun(ctx, `buyer:${ctx.buyerId}`, async (keyValid) =>
    ok(await refundTickets(ctx.buyerId, id, ctx.body, keyValid, ctx.now)))],
  ["GET", /^\/api\/waitlist$/, async (ctx) => ok({ entries: await entriesOf(pool, ctx.buyerId, ctx.now) })],
  ["GET", /^\/api\/offers\/([^/]+)$/, async (ctx, [token]) => {
    const offer = await offerByToken(pool, token, ctx.now);
    if (!offer) throw fail(404, "not_found");
    return ok({ offer });
  }],
  ["POST", /^\/api\/offers\/([^/]+)\/accept$/, (ctx, [token]) => keyedRun(ctx, `buyer:${ctx.buyerId}:offer:${token}`, async (keyValid) =>
    ok({ order: await acceptOffer(ctx.buyerId, token, keyValid, ctx.now) }, 201))],
  ["POST", /^\/api\/offers\/([^/]+)\/decline$/, async (ctx, [token]) => ok({ offer: await declineOffer(ctx.buyerId, token, ctx.now) })],
  ["POST", /^\/api\/owner\/session$/, async (ctx) => ({ status: 204, cookies: [setCookie(OWNER_COOKIE, await signIn(ctx.body))] })],
  ["DELETE", /^\/api\/owner\/session$/, async (ctx) => {
    await signOut(ctx.ownerToken);
    return { status: 204, cookies: [clearCookie(OWNER_COOKIE)] };
  }],
  ["GET", /^\/api\/owner\/performances$/, owned(async (ctx) => ok({ performances: await ownerPerformances(pool, ctx.now) }))],
  ["POST", /^\/api\/owner\/performances$/, owned(async (ctx) => ok({ performance: await publish(ctx.body, ctx.now) }, 201))],
  ["GET", /^\/api\/owner\/orders$/, owned(async () => ok({ orders: await ordersWhere(pool, "true", []) }))],
  ["GET", /^\/api\/owner\/outbox$/, owned(async () => ok({ messages: await outbox() }))],
];

export async function route(ctx: Context): Promise<Reply> {
  for (const [method, pattern, handler] of ROUTES) {
    const match = pattern.exec(ctx.path);
    if (match && method === ctx.method) {
      let params: string[];
      try {
        params = match.slice(1).map(decodeURIComponent);
      } catch {
        throw fail(404, "not_found");
      }
      // No id holds a control character (Postgres refuses a NUL byte in text): such an id names nothing.
      if (params.some((p) => /[\u0000-\u001f\u007f]/.test(p))) throw fail(404, "not_found");
      return handler(ctx, params);
    }
  }
  throw fail(404, "not_found");
}
