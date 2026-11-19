// The API: every endpoint of the brief, wired to the services. Error precedence inside each handler:
// unknown id (404), then role (403), then request key, then state conflicts (409), then validation (422).
import { availability, listProducts, productObject, requireProduct } from "./catalogue.js";
import { CART_MAX_QUANTITY, cartObject, cartShops, placeHold, putArea, putLine, putShop, requireShopper } from "./cart.js";
import { pool, transaction } from "./db.js";
import { notFound, validationFailed } from "./errors.js";
import { type Reply, publicRoute, route } from "./http.js";
import { activeHoldsOf, deleteHold, holdObject, loadOwnHold } from "./holds.js";

import { landingFor } from "../shared/routes.js";
import { endSession, sessionCookie, signIn, userJson, userObject } from "./auth.js";
import {
  estateReview, getOrder, listOrders, orderDocument, orderHistory, orderReplay, placeOrder, transitionOrder,
} from "./orders.js";
import { type Answer, readRequestKey, withRequestKey } from "./requestKeys.js";
import { listReturns, requestReturn, returnLabel, transitionReturn } from "./returns.js";
import { searchTerm } from "./search.js";
import { storageStatus } from "./storage.js";
import { COUNT_LIMIT, claimForSale, countStock, stockLine, stockLines, stockObject } from "./stock.js";
import {
  DISPLAY_STATES, type DisplayState, dayPlan, hoursObject, isDisplayState, listShops, publishHours, requireShopManager,
  requireStockReader, requireShop, setSuspension, slotsAnswer, shopObject,
} from "./shops.js";

const JSON_TYPE = "application/json; charset=utf-8";

function answered(answer: Answer): Reply {
  return { status: answer.status, text: answer.text, contentType: JSON_TYPE };
}

function parseStates(raw: string | null): DisplayState[] | null {
  if (raw === null || raw.trim() === "") return null;
  const states: DisplayState[] = [];
  for (const part of raw.split(",")) {
    const word = part.trim();
    if (!isDisplayState(word)) throw validationFailed({ state: `Use any of ${DISPLAY_STATES.join(", ")}.` });
    states.push(word);
  }
  return states;
}

export function registerRoutes(): void {
  // ---- session ----
  publicRoute("POST", "/api/session", async (ctx) => {
    const input = ctx.looseBody();
    const { token, user } = await signIn(input?.email, input?.password, ctx.now);
    return {
      status: 200, headers: { "set-cookie": sessionCookie(token) },
      json: { user: userJson(user), landing: landingFor(user.role, user.store_ids ?? []) },
    };
  });

  route("GET", "/api/me", async ({ user }) => ({
    status: 200,
    json: { user: userObject(user), operator: { id: user.operatorId, name: user.operatorName }, store_ids: user.shopIds, session_expires_at: user.expiresAt.toISOString() },
  }));

  route("DELETE", "/api/session", async (ctx) => {
    await endSession(ctx.req.headers.cookie);
    return { status: 204, text: "" };
  });

  publicRoute("GET", "/api/health", async () => ({ status: 200, json: { status: "ok" } }));
  publicRoute("GET", "/api/status", async () => ({ status: 200, json: storageStatus() }));

  // ---- shops ----
  route("GET", "/api/stores", async ({ user, url, now }) => {
    const term = searchTerm(url.searchParams.get("q"));
    return { status: 200, json: await listShops(user, term, parseStates(url.searchParams.get("state")), now) };
  });

  route("GET", "/api/stores/:id", async ({ user, params, now }) => ({
    status: 200, json: shopObject(await requireShop(pool, user, params.id), now),
  }));

  route("POST", "/api/stores/:id/suspension", async (ctx) => ({
    status: 200, json: await setSuspension(ctx.user, ctx.params.id ?? "", ctx.looseBody() ?? {}, ctx.now),
  }));

  route("GET", "/api/stores/:id/stock", async ({ user, params }) => {
    const shop = await requireShop(pool, user, params.id);
    requireStockReader(user, shop.id);
    return { status: 200, json: { store_id: shop.id, lines: (await stockLines(pool, shop.id)).map(stockObject) } };
  });

  route("POST", "/api/stores/:id/stock/:sku/count", async (ctx) => {
    const shop = await requireShop(pool, ctx.user, ctx.params.id);
    requireStockReader(ctx.user, shop.id);
    const line = await stockLine(pool, shop.id, ctx.params.sku ?? "");
    if (!line) throw notFound();
    requireShopManager(ctx.user, shop.id);
    const onHand = ctx.looseBody()?.on_hand;
    if (typeof onHand !== "number" || !Number.isInteger(onHand) || onHand < 0 || onHand > COUNT_LIMIT) {
      throw validationFailed({ on_hand: `Use a whole number from 0 to ${COUNT_LIMIT}.` });
    }
    const counted = await transaction((db) => countStock(db, shop.id, line.sku, onHand));
    const { name: _name, ...rest } = stockObject(counted);
    return { status: 200, json: rest };
  });

  route("POST", "/api/stores/:id/till-sales", async (ctx) => {
    const shop = await requireShop(pool, ctx.user, ctx.params.id);
    requireStockReader(ctx.user, shop.id);
    const input = ctx.looseBody();
    if (typeof input?.sku === "string" && !(await stockLine(pool, shop.id, input.sku))) throw notFound();
    requireShopManager(ctx.user, shop.id);
    const key = readRequestKey(ctx.header("request-key"));
    const answer = await withRequestKey(ctx.user, key, input ?? {}, ctx.now, async () => {
      const sku = input?.sku;
      const quantity = input?.quantity;
      const problems: Record<string, string> = {};
      if (typeof sku !== "string") problems.sku = "Choose an item.";
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > CART_MAX_QUANTITY) problems.quantity = `Use a whole number from 1 to ${CART_MAX_QUANTITY}.`;
      if (typeof sku !== "string" || typeof quantity !== "number" || Object.keys(problems).length > 0) throw validationFailed(problems);
      const sold = await transaction(async (db) => {
        await claimForSale(db, shop.id, sku, quantity);
        return stockLine(db, shop.id, sku);
      });
      if (!sold) throw notFound();
      const stock = stockObject(sold);
      return { status: 201, text: JSON.stringify({ store_id: shop.id, sku: stock.sku, on_hand: stock.on_hand, held: stock.held, available: stock.available }) };
    });
    return answered(answer);
  });

  route("GET", "/api/stores/:id/holds", async ({ user, params, now }) => {
    const shop = await requireShop(pool, user, params.id);
    requireStockReader(user, shop.id);
    return { status: 200, json: { holds: await Promise.all((await activeHoldsOf(shop.id)).map((hold) => holdObject(pool, hold, now))) } };
  });

  route("GET", "/api/stores/:id/hours", async ({ user, params, now }) => ({
    status: 200, json: hoursObject(await requireShop(pool, user, params.id), now),
  }));

  route("PUT", "/api/stores/:id/hours", async (ctx) => ({
    status: 200, json: await publishHours(ctx.user, ctx.params.id ?? "", ctx.looseBody() ?? {}, ctx.now),
  }));

  route("GET", "/api/stores/:id/day-plan", async ({ user, params, url, now }) => ({
    status: 200, json: await dayPlan(user, params.id ?? "", url.searchParams.get("date"), now),
  }));

  route("GET", "/api/stores/:id/slots", async ({ user, params, now }) => ({
    status: 200, json: await slotsAnswer(user, params.id ?? "", now),
  }));

  // ---- catalogue ----
  route("GET", "/api/products", async ({ user, url }) => ({
    status: 200, json: await listProducts(user, searchTerm(url.searchParams.get("q"))),
  }));

  route("GET", "/api/products/:sku", async ({ user, params }) => ({
    status: 200, json: productObject(await requireProduct(user, params.sku)),
  }));

  route("GET", "/api/products/:sku/availability", async ({ user, params, url, now }) => ({
    status: 200, json: await availability(user, params.sku ?? "", url.searchParams.get("lat"), url.searchParams.get("lon"), now),
  }));

  // ---- cart and holds ----
  route("GET", "/api/cart", async ({ user, now }) => {
    requireShopper(user);
    return { status: 200, json: await cartObject(user, now) };
  });
  route("PUT", "/api/cart/lines/:sku", async (ctx) => ({ status: 200, json: await putLine(ctx.user, ctx.params.sku ?? "", ctx.looseBody(), ctx.now) }));
  route("PUT", "/api/cart/store", async (ctx) => ({ status: 200, json: await putShop(ctx.user, ctx.looseBody(), ctx.now) }));
  route("PUT", "/api/cart/area", async (ctx) => ({ status: 200, json: await putArea(ctx.user, ctx.looseBody(), ctx.now) }));
  route("GET", "/api/cart/shops", async ({ user, now }) => ({ status: 200, json: await cartShops(user, now) }));

  route("POST", "/api/holds", async ({ user, now }) => ({ status: 201, json: await placeHold(user, now) }));
  route("GET", "/api/holds/:id", async ({ user, params, now }) => {
    return { status: 200, json: await holdObject(pool, await loadOwnHold(user, params.id, now), now) };
  });
  route("DELETE", "/api/holds/:id", async ({ user, params, now }) => ({ status: 200, json: await deleteHold(user, params.id, now) }));

  // ---- orders ----
  route("POST", "/api/orders", async (ctx) => {
    const input = ctx.looseBody();
    const hold = input?.hold_id === undefined ? null : await loadOwnHold(ctx.user, input.hold_id, ctx.now);
    requireShopper(ctx.user);
    const key = readRequestKey(ctx.header("request-key"));
    const answer = await withRequestKey(ctx.user, key, input ?? {}, ctx.now, async (handle) => {
      if (!hold) throw validationFailed({ hold_id: "Name the hold to place." });
      return placeOrder(ctx.user, input, hold, ctx.now, handle);
    });
    return answered(answer);
  });
  route("GET", "/api/orders", async ({ user, url }) => ({ status: 200, json: await listOrders(user, url.searchParams) }));
  route("GET", "/api/orders/:id", async ({ user, params }) => ({ status: 200, json: await getOrder(user, params.id ?? "") }));
  route("POST", "/api/orders/:id/transitions", async (ctx) => ({
    status: 200, json: await transitionOrder(ctx.user, ctx.params.id ?? "", ctx.looseBody(), ctx.now),
  }));
  route("GET", "/api/orders/:id/document", async ({ user, params }) => ({
    status: 200, buffer: await orderDocument(user, params.id ?? ""), contentType: "application/json",
    headers: { "content-disposition": `attachment; filename="order-${params.id}.json"` },
  }));
  route("GET", "/api/orders/:id/events", async ({ user, params }) => ({ status: 200, json: await orderHistory(user, params.id ?? "") }));
  route("GET", "/api/orders/:id/replay", async ({ user, params }) => ({ status: 200, json: await orderReplay(user, params.id ?? "") }));
  route("POST", "/api/orders/:id/returns", async (ctx) => ({
    status: 201, json: await requestReturn(ctx.user, ctx.params.id ?? "", ctx.looseBody(), ctx.now),
  }));

  // ---- returns ----
  route("GET", "/api/returns", async ({ user, url }) => ({ status: 200, json: await listReturns(user, url.searchParams.get("store_id")) }));
  route("POST", "/api/returns/:id/transitions", async (ctx) => ({
    status: 200, json: await transitionReturn(ctx.user, ctx.params.id ?? "", ctx.looseBody(), ctx.now),
  }));
  route("POST", "/api/returns/:id/label", async ({ user, params }) => ({
    status: 200, text: await returnLabel(user, params.id ?? ""), contentType: "text/plain; charset=utf-8",
  }));

  // ---- estate ----
  route("GET", "/api/estate/review", async ({ user, now }) => ({ status: 200, json: await estateReview(user, now) }));
}


