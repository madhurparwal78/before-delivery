// The published API surface (brief: Endpoints), plus /api/_clock only when CLOCK_CONTROL is enabled.
import { config } from "./config.ts";
import { catalogBody, loadCatalog } from "./catalog.ts";
import { pool } from "./db.ts";
import { invalid } from "./errors.ts";
import { iso, now, parseIsoUtc, setClock } from "./clock.ts";
import { listOutbox } from "./outbox.ts";
import { ok, type AuthedCtx, type Ctx, type Endpoint, type Reply, type RouteTable, type Who } from "./http.ts";
import { changePassword, confirmReset, login, logout, me, requestReset, signup } from "./domain/accounts.ts";
import { buildNotFound, checkPicks, priceBuild, saveBuild, savedPicks } from "./domain/builds.ts";
import { addLine, applyCode, findCart, importShared, readCart, removeCode, removeLine, SHARE_HEADERS, shareCart, sharedSnapshot, updateLine } from "./domain/cart.ts";
import { quoteCheckout } from "./domain/checkout.ts";
import { requestCallback } from "./domain/callbacks.ts";
import { addSlot, book, cancelBooking, locationBookings, markAttended, myBookings, searchLocations, upcomingEvents, upcomingSlots } from "./domain/demo.ts";
import { lookupCase, openCase, trackOrder } from "./domain/lookups.ts";
import { createMatch, readMatch } from "./domain/match.ts";
import { advanceOrder, cancelOrder, listOrders, placeOrder, readOrder } from "./domain/orders.ts";
import { addProtection } from "./domain/protection.ts";
import { myRegistrations, register, transfer } from "./domain/registrations.ts";
import { search } from "./domain/search.ts";
import { applyAsPartner, subscribe } from "./domain/signups.ts";
import { myTradeIns, quoteTradeIn, readTradeIn, rejectTradeIn, respond, staffTradeIns, submitTradeIn } from "./domain/tradeins.ts";

const anyone = (handler: (ctx: Ctx) => Promise<Reply>): Endpoint => ({ who: "anyone", handler });
const authed = (who: Exclude<Who, "anyone">, handler: (ctx: AuthedCtx) => Promise<Reply>): Endpoint => ({
  who,
  handler: (ctx) => handler(ctx as AuthedCtx),
});
const customer = (handler: (ctx: AuthedCtx) => Promise<Reply>) => authed("customer", handler);
const p = (ctx: Ctx, name: string) => ctx.params[name] as string;

export const routes: RouteTable = {
  "/api/health": { GET: anyone(async () => ok({ status: "ok" })) },
  "/api/auth/signup": { POST: anyone(async (ctx) => ok({ user: await signup(ctx) }, 201)) },
  "/api/auth/login": { POST: anyone(async (ctx) => ok({ user: await login(ctx) })) },
  "/api/auth/logout": { POST: authed("signed_in", async (ctx) => (await logout(ctx), ok({}))) },
  "/api/auth/password-reset": { POST: anyone(async (ctx) => ok(await requestReset(ctx.body), 202)) },
  "/api/auth/password-reset/confirm": { POST: anyone(async (ctx) => ok(await confirmReset(ctx.body))) },
  "/api/auth/password": { POST: authed("signed_in", async (ctx) => (await changePassword(ctx), ok({}))) },
  "/api/me": { GET: authed("signed_in", async (ctx) => ok(await me(ctx))) },

  "/api/catalog": {
    GET: anyone(async () => ok(catalogBody(await loadCatalog(pool)))),
  },
  "/api/builds/quote": {
    POST: anyone(async (ctx) => {
      const catalog = await loadCatalog(pool);
      return ok(priceBuild(checkPicks(ctx.body, catalog), catalog));
    }),
  },
  "/api/builds": {
    POST: anyone(async (ctx) => {
      const catalog = await loadCatalog(pool);
      const picks = checkPicks(ctx.body, catalog);
      return ok(priceBuild(picks, catalog), (await saveBuild(pool, picks)) ? 201 : 200);
    }),
  },
  "/api/builds/:code": {
    GET: anyone(async (ctx) => {
      const picks = await savedPicks(pool, p(ctx, "code"));
      if (!picks) throw buildNotFound();
      return ok(priceBuild(picks, await loadCatalog(pool)));
    }),
  },
  "/api/match": { POST: anyone(async (ctx) => ok(await createMatch(pool, ctx.body), 201)) },
  "/api/match/:id": { GET: anyone(async (ctx) => ok(await readMatch(pool, p(ctx, "id")))) },

  "/api/cart": { GET: anyone(async (ctx) => ok(await readCart(pool, ctx))) },
  "/api/cart/lines": { POST: anyone(async (ctx) => ok(await addLine(ctx))) },
  "/api/cart/lines/:id": {
    PATCH: anyone(async (ctx) => ok(await updateLine(ctx, p(ctx, "id")))),
    DELETE: anyone(async (ctx) => ok(await removeLine(ctx, p(ctx, "id")))),
  },
  "/api/cart/codes": { POST: anyone(async (ctx) => ok(await applyCode(ctx))) },
  "/api/cart/codes/:code": { DELETE: anyone(async (ctx) => ok(await removeCode(ctx, p(ctx, "code")))) },
  "/api/cart/share": { POST: anyone(async (ctx) => ok(await shareCart(pool, ctx), 201)) },
  "/api/cart/shared/:token": { GET: anyone(async (ctx) => ({ ...ok(await sharedSnapshot(pool, p(ctx, "token"))), headers: SHARE_HEADERS })) },
  "/api/cart/shared/:token/import": { POST: anyone(async (ctx) => ok(await importShared(ctx, p(ctx, "token")))) },

  "/api/checkout/quote": { POST: customer(async (ctx) => ok(await quoteCheckout(pool, await findCart(pool, ctx), ctx.user.id, ctx.body))) },
  "/api/orders": {
    GET: customer(async (ctx) => ok(await listOrders(pool, ctx.user.id, ctx.query))),
    POST: customer(async (ctx) => {
      const { status, order } = await placeOrder(ctx);
      return ok(order, status);
    }),
  },
  "/api/orders/:number": { GET: customer(async (ctx) => ok(await readOrder(pool, ctx.user, p(ctx, "number")))) },
  "/api/orders/:number/cancel": { POST: customer(async (ctx) => ok(await cancelOrder(ctx.user, p(ctx, "number")))) },
  "/api/orders/:number/protection": { POST: customer(async (ctx) => ok(await addProtection(ctx.user, p(ctx, "number"), ctx.body), 201)) },

  "/api/registrations": { POST: customer(async (ctx) => ok(await register(ctx.user, ctx.body), 201)) },
  "/api/registrations/mine": { GET: customer(async (ctx) => ok({ registrations: await myRegistrations(pool, ctx.user) })) },
  "/api/registrations/:serial/transfer": { POST: customer(async (ctx) => ok(await transfer(ctx.user, p(ctx, "serial"), ctx.body))) },

  "/api/trade-ins": { POST: customer(async (ctx) => ok(await submitTradeIn(ctx.user, ctx.body), 201)) },
  "/api/trade-ins/mine": { GET: customer(async (ctx) => ok({ trade_ins: await myTradeIns(pool, ctx.user) })) },
  "/api/trade-ins/:id": { GET: customer(async (ctx) => ok(await readTradeIn(pool, ctx.user, p(ctx, "id")))) },
  "/api/trade-ins/:id/accept": { POST: customer(async (ctx) => ok(await respond(ctx.user, p(ctx, "id"), "accept"))) },
  "/api/trade-ins/:id/decline": { POST: customer(async (ctx) => ok(await respond(ctx.user, p(ctx, "id"), "decline"))) },

  "/api/locations": { GET: anyone(async (ctx) => ok({ locations: await searchLocations(pool, ctx.query) })) },
  "/api/locations/:id/slots": { GET: anyone(async (ctx) => ok({ slots: await upcomingSlots(pool, p(ctx, "id")) })) },
  "/api/demo-bookings": { POST: customer(async (ctx) => ok(await book(ctx.user, ctx.body), 201)) },
  "/api/demo-bookings/mine": { GET: customer(async (ctx) => ok({ bookings: await myBookings(pool, ctx.user) })) },
  "/api/demo-bookings/:id/cancel": { POST: customer(async (ctx) => ok(await cancelBooking(ctx.user, p(ctx, "id")))) },
  "/api/events": { GET: anyone(async () => ok({ events: await upcomingEvents(pool) })) },

  "/api/callbacks": { POST: anyone(async (ctx) => ok(await requestCallback(ctx.body), 201)) },
  "/api/track": { POST: anyone(async (ctx) => ok(await trackOrder(ctx.body))) },
  "/api/cases": { POST: anyone(async (ctx) => ok(await openCase(ctx.body), 201)) },
  "/api/cases/lookup": { POST: anyone(async (ctx) => ok(await lookupCase(ctx.body))) },
  "/api/newsletter": {
    POST: anyone(async (ctx) => {
      const { created, message } = await subscribe(ctx.body);
      return ok({ message }, created ? 201 : 200);
    }),
  },
  "/api/partner-applications": { POST: anyone(async (ctx) => ok(await applyAsPartner(ctx.body), 201)) },
  "/api/search": { GET: anyone(async (ctx) => ok({ results: await search(pool, ctx.query.get("q")) })) },

  "/api/staff/trade-ins": { GET: authed(["admin", "support"], async (ctx) => ok({ trade_ins: await staffTradeIns(pool, ctx.query.get("status")) })) },
  "/api/staff/trade-ins/:id/quote": { POST: authed(["admin", "support"], async (ctx) => ok(await quoteTradeIn(p(ctx, "id"), ctx.body))) },
  "/api/staff/trade-ins/:id/reject": { POST: authed(["admin", "support"], async (ctx) => ok(await rejectTradeIn(p(ctx, "id"), ctx.body))) },
  "/api/staff/locations/:id/slots": { POST: authed(["admin", "dealer"], async (ctx) => ok(await addSlot(p(ctx, "id"), ctx.body), 201)) },
  "/api/staff/locations/:id/bookings": { GET: authed(["admin", "dealer"], async (ctx) => ok({ bookings: await locationBookings(pool, ctx.user, p(ctx, "id")) })) },
  "/api/staff/demo-bookings/:id/attended": { POST: authed(["admin", "dealer"], async (ctx) => ok(await markAttended(ctx.user, p(ctx, "id")))) },
  "/api/staff/orders": {
    GET: authed(["admin"], async (ctx) => ok(await listOrders(pool, null, ctx.query))),
  },
  "/api/staff/orders/:number/ship": { POST: authed(["admin"], async (ctx) => ok(await advanceOrder(ctx.user, p(ctx, "number"), "ship"))) },
  "/api/staff/orders/:number/deliver": { POST: authed(["admin"], async (ctx) => ok(await advanceOrder(ctx.user, p(ctx, "number"), "deliver"))) },
  "/api/staff/outbox": { GET: authed(["admin", "support"], async () => ok({ notices: await listOutbox() })) },
};

if (config.clockControl) {
  routes["/api/_clock"] = {
    PUT: anyone(async (ctx) => {
      const instant = typeof ctx.body.now === "string" && /Z$/.test(ctx.body.now) ? parseIsoUtc(ctx.body.now) : null;
      if (!instant) throw invalid({ now: "Send an ISO 8601 UTC time ending in Z." });
      setClock(instant);
      return ok({ now: iso(now()) });
    }),
    DELETE: anyone(async () => {
      setClock(null);
      return ok({ now: iso(now()) });
    }),
  };
}
