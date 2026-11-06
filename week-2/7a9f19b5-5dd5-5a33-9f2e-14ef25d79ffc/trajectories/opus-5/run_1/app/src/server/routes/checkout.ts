/**
 * Checkout. Clearance units are reserved in the transaction that checks them,
 * before any Kill Bill call; a decline or a Kill Bill outage releases them again.
 * An order never ends up with more than one successful Kill Bill authorisation.
 */

import type { PoolClient } from "pg";
import { query, transaction } from "../db/pool.js";
import { DECLINE_TEST_CARD, LIMITS, normaliseCardNumber, passesLuhn } from "../../shared/domain.js";
import { canAuthorise, canPlaceOnAccount } from "../../shared/orderState.js";
import { hasTradeAccount, priceTierFor } from "../../shared/projection.js";
import { isExpiryInFuture } from "../../shared/dates.js";
import type { Order, User } from "../../shared/types.js";
import { readJson, sendJson, type Ctx } from "../http/context.js";
import {
  cardDeclined,
  emptyCart,
  invalidState,
  notFound,
  paymentUnavailable,
  tradeAccountRequired,
} from "../http/errors.js";
import { requireUser, viewerOf } from "../http/router.js";
import { FieldErrors, optionalString, requiredString } from "../http/validate.js";
import {
  loadOrderByKey,
  loadOrderIn,
  openCartFor,
  releaseClearanceStock,
  reserveClearanceStock,
  toOrderDto,
  type LoadedOrder,
} from "../domain/orders.js";
import { requireIdempotencyKey, runOnce, type IdempotentOutcome } from "../domain/idempotency.js";
import { serverToday } from "../domain/today.js";
import * as killbill from "../services/killbill.js";
import { sendOrderConfirmation } from "../services/mail.js";
import { ProviderUnavailable } from "../services/provider.js";

interface Delivery {
  name: string;
  address: string;
  city: string;
  postcode: string;
}

function readDelivery(errors: FieldErrors, raw: unknown): Delivery {
  const source = (raw ?? {}) as Record<string, unknown>;
  const delivery = {
    name: requiredString(errors, "name", source.name, { max: 120 }),
    address: requiredString(errors, "address", source.address, { max: 200 }),
    city: requiredString(errors, "city", source.city, { max: 80 }),
    // The rule is "4 digits", so a postcode of the wrong length is invalid, not too long.
    postcode: requiredString(errors, "postcode", source.postcode),
  };
  if (delivery.postcode !== "" && !/^\d{4}$/.test(delivery.postcode)) errors.set("postcode", "invalid");
  return delivery;
}

/** Finds the caller's own order by key, or reports it as missing. */
async function ownOrder(user: User, orderKey: string): Promise<LoadedOrder> {
  const loaded = await loadOrderByKey(orderKey);
  if (!loaded || loaded.record.user_id !== user.id) throw notFound();
  return loaded;
}

export async function authorise(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const orderKey = ctx.params.orderKey ?? "";
  const key = requireIdempotencyKey(ctx);

  const outcome = await runOnce({
    userId: user.id,
    endpoint: "authorise",
    key,
    body: ctx.body,
    work: () => authoriseOnce(ctx, user, orderKey),
  });
  sendJson(ctx.res, outcome.status, outcome.body);
}

async function authoriseOnce(ctx: Ctx, user: User, orderKey: string): Promise<IdempotentOutcome> {
  const body = readJson<{ card?: unknown; delivery?: unknown }>(ctx);
  const errors = new FieldErrors();

  const card = (body.card ?? {}) as Record<string, unknown>;
  const rawNumber = requiredString(errors, "number", card.number, { max: 32 });
  const digits = normaliseCardNumber(rawNumber);
  if (rawNumber !== "" && (digits.length !== 16 || !passesLuhn(digits))) errors.set("number", "invalid");

  const expiry = requiredString(errors, "expiry", card.expiry, { max: 5 });
  if (expiry !== "" && !isExpiryInFuture(expiry, serverToday())) errors.set("expiry", "invalid");

  const cvc = requiredString(errors, "cvc", card.cvc, { max: 3 });
  if (cvc !== "" && !/^\d{3}$/.test(cvc)) errors.set("cvc", "invalid");

  // The delivery block also has a `name`, so the card holder reports separately.
  requiredString(errors, "card_name", card.name, { max: 120 });
  const delivery = readDelivery(errors, body.delivery);
  errors.throwIfAny();

  const existing = await ownOrder(user, orderKey);
  if (!canAuthorise(existing.record.status)) throw invalidState(existing.record.status);

  // Reprice to the caller's tier, then reserve the clearance units in the same
  // transaction that checks them, before Kill Bill is called at all.
  const tier = priceTierFor(viewerOf(ctx));
  const reserved = await transaction(async (client) => {
    const order = await openCartFor(client, user.id, tier);
    if (order.record.order_key !== orderKey) throw invalidState(order.record.status);
    if (!canAuthorise(order.record.status)) throw invalidState(order.record.status);
    if (order.lines.length === 0) throw emptyCart();
    await reserveClearanceStock(client, order);
    await client.query(
      "UPDATE orders SET payment_method = 'card', card_last4 = $2, delivery = $3 WHERE id = $1",
      [order.record.id, digits.slice(-4), JSON.stringify(delivery)],
    );
    return order;
  });

  // The published decline card never reaches Kill Bill, so no payment is created.
  if (digits === DECLINE_TEST_CARD) {
    const declined = await settle(orderKey, "declined", (client) => releaseClearanceStock(client, reserved));
    throw cardDeclined(declined);
  }

  try {
    const accountId = await killbill.ensureAccount({ userId: user.id, name: user.name });
    const result = await killbill.authorise({
      accountId,
      orderKey,
      totalCents: reserved.record.total_cents,
    });
    await query("UPDATE users SET kb_account_id = $2 WHERE id = $1", [user.id, accountId]);

    const order = await settle(orderKey, "authorised", async (client) => {
      await client.query("UPDATE orders SET kb_payment_id = $2 WHERE order_key = $1", [
        orderKey,
        result.kb_payment_id,
      ]);
    });
    await sendConfirmationOnce(orderKey, user.email);
    return { status: 200, body: { order } };
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
    const order = await settle(orderKey, "gateway_unavailable", (client) =>
      releaseClearanceStock(client, reserved),
    );
    throw paymentUnavailable({ order });
  }
}

/** Writes the order's new state and returns the published order object. */
async function settle(
  orderKey: string,
  status: "authorised" | "declined" | "gateway_unavailable" | "placed",
  extra: (client: PoolClient) => Promise<void>,
): Promise<Order> {
  return transaction(async (client) => {
    await extra(client);
    await client.query("UPDATE orders SET status = $2 WHERE order_key = $1", [orderKey, status]);
    const order = await loadOrderIn(client, orderKey);
    if (!order) throw new Error(`order ${orderKey} disappeared while it was being settled`);
    return toOrderDto(order, serverToday());
  });
}

/**
 * One confirmation email per order, sent when it is authorised or placed. The
 * marker is claimed first so a replayed authorisation cannot send a second copy,
 * and released again if Mailpit refuses the message.
 */
async function sendConfirmationOnce(orderKey: string, email: string): Promise<void> {
  const claimed = await query<{ order_key: string }>(
    `UPDATE orders SET confirmation_sent_at = now()
     WHERE order_key = $1 AND confirmation_sent_at IS NULL
     RETURNING order_key`,
    [orderKey],
  );
  if (claimed.length === 0) return;

  const order = await loadOrderByKey(orderKey);
  if (!order) return;
  try {
    await sendOrderConfirmation({ to: email, order: toOrderDto(order, serverToday()) });
  } catch {
    await query("UPDATE orders SET confirmation_sent_at = NULL WHERE order_key = $1", [orderKey]);
  }
}

export async function placeOnAccount(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  if (!hasTradeAccount(user)) throw tradeAccountRequired();
  const orderKey = ctx.params.orderKey ?? "";
  const key = requireIdempotencyKey(ctx);

  const outcome = await runOnce({
    userId: user.id,
    endpoint: "place-on-account",
    key,
    body: ctx.body,
    work: () => placeOnAccountOnce(ctx, user, orderKey),
  });
  sendJson(ctx.res, outcome.status, outcome.body);
}

async function placeOnAccountOnce(ctx: Ctx, user: User, orderKey: string): Promise<IdempotentOutcome> {
  const body = readJson<{ delivery?: unknown; purchase_order?: unknown }>(ctx);
  const errors = new FieldErrors();
  const delivery = readDelivery(errors, body.delivery);
  const purchaseOrder = optionalString(errors, "purchase_order", body.purchase_order, {
    max: LIMITS.purchaseOrder.max,
  });
  errors.throwIfAny();

  const existing = await ownOrder(user, orderKey);
  if (!canPlaceOnAccount(existing.record.status)) throw invalidState(existing.record.status);

  await transaction(async (client) => {
    const order = await openCartFor(client, user.id, "trade");
    if (order.record.order_key !== orderKey) throw invalidState(order.record.status);
    if (!canPlaceOnAccount(order.record.status)) throw invalidState(order.record.status);
    if (order.lines.length === 0) throw emptyCart();
    await reserveClearanceStock(client, order);
    await client.query(
      "UPDATE orders SET payment_method = 'account', purchase_order = $2, delivery = $3 WHERE id = $1",
      [order.record.id, purchaseOrder, JSON.stringify(delivery)],
    );
  });

  // Placing on account does not call Kill Bill.
  const order = await settle(orderKey, "placed", async () => undefined);
  await sendConfirmationOnce(orderKey, user.email);
  return { status: 200, body: { order } };
}

export async function listOrders(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const today = serverToday();
  const keys = await query<{ order_key: string }>(
    `SELECT order_key FROM orders
     WHERE user_id = $1 AND status NOT IN ('cart','declined','gateway_unavailable')
     ORDER BY created_at DESC`,
    [user.id],
  );
  const orders: Order[] = [];
  for (const { order_key: orderKey } of keys) {
    const loaded = await loadOrderByKey(orderKey);
    if (loaded) orders.push(toOrderDto(loaded, today));
  }
  sendJson(ctx.res, 200, { orders });
}

export async function getOrder(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const loaded = await loadOrderByKey(ctx.params.orderKey ?? "");
  if (!loaded) throw notFound();
  if (loaded.record.user_id !== user.id && user.role !== "admin") throw notFound();
  sendJson(ctx.res, 200, { order: toOrderDto(loaded, serverToday()) });
}
