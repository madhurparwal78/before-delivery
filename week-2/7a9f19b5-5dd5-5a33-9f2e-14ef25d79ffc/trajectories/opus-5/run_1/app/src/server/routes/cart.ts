/**
 * Cart reads and edits. Lines can be changed only while the order is open, which
 * is the `cart`, `declined` and `gateway_unavailable` states.
 */

import { transaction } from "../db/pool.js";
import { LIMITS } from "../../shared/domain.js";
import { isOpenCart } from "../../shared/orderState.js";
import { priceTierFor, unitPriceCentsFor } from "../../shared/projection.js";
import { readJson, sendJson, type Ctx } from "../http/context.js";
import { insufficientStock, invalidState, notFound } from "../http/errors.js";
import { requireUser, viewerOf } from "../http/router.js";
import { FieldErrors, requiredInteger, requiredString } from "../http/validate.js";
import { loadOrderIn, openCartFor, recomputeTotals, stockOnHand, toOrderDto } from "../domain/orders.js";
import { serverToday } from "../domain/today.js";
import { loadVariant } from "../domain/catalogue.js";

export async function getCart(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const tier = priceTierFor(viewerOf(ctx));
  const order = await transaction((client) => openCartFor(client, user.id, tier));
  sendJson(ctx.res, 200, { order: toOrderDto(order, serverToday()) });
}

export async function addCartLine(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const tier = priceTierFor(viewerOf(ctx));
  const body = readJson<{ variant_code?: unknown; quantity?: unknown }>(ctx);

  const errors = new FieldErrors();
  const code = requiredString(errors, "variant_code", body.variant_code, { max: 40 });
  const quantity = requiredInteger(errors, "quantity", body.quantity, LIMITS.quantity);
  errors.throwIfAny();

  const variant = await loadVariant(code);
  if (!variant) throw notFound();

  const order = await transaction(async (client) => {
    const cart = await openCartFor(client, user.id, tier);
    if (!isOpenCart(cart.record.status)) throw invalidState(cart.record.status);

    const existing = cart.lines.find((line) => line.variant_code === code);
    const wanted = (existing?.quantity ?? 0) + quantity;

    // Adding more clearance units than are on hand is refused outright.
    if (variant.clearance) {
      const onHand = await stockOnHand(client, code);
      if (wanted > onHand) throw insufficientStock(onHand);
    }

    await client.query(
      `INSERT INTO order_lines (order_id, variant_code, quantity, unit_price_cents)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (order_id, variant_code)
         DO UPDATE SET quantity = order_lines.quantity + EXCLUDED.quantity,
                       unit_price_cents = EXCLUDED.unit_price_cents`,
      [cart.record.id, code, quantity, unitPriceCentsFor(variant, tier)],
    );
    await recomputeTotals(client, cart.record.id);

    const reloaded = await loadOrderIn(client, cart.record.order_key);
    if (!reloaded) throw new Error("the cart disappeared while a line was added");
    return reloaded;
  });

  sendJson(ctx.res, 200, { order: toOrderDto(order, serverToday()) });
}

export async function setCartLineQuantity(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const tier = priceTierFor(viewerOf(ctx));
  const code = ctx.params.code ?? "";
  const body = readJson<{ quantity?: unknown }>(ctx);

  const errors = new FieldErrors();
  const quantity = requiredInteger(errors, "quantity", body.quantity, { min: 0, max: LIMITS.quantity.max });
  errors.throwIfAny();

  const variant = await loadVariant(code);
  if (!variant) throw notFound();

  const order = await transaction(async (client) => {
    const cart = await openCartFor(client, user.id, tier);
    if (!isOpenCart(cart.record.status)) throw invalidState(cart.record.status);
    if (!cart.lines.some((line) => line.variant_code === code)) throw notFound();

    if (quantity === 0) {
      await client.query("DELETE FROM order_lines WHERE order_id = $1 AND variant_code = $2", [
        cart.record.id,
        code,
      ]);
    } else {
      if (variant.clearance) {
        const onHand = await stockOnHand(client, code);
        if (quantity > onHand) throw insufficientStock(onHand);
      }
      await client.query("UPDATE order_lines SET quantity = $3 WHERE order_id = $1 AND variant_code = $2", [
        cart.record.id,
        code,
        quantity,
      ]);
    }
    await recomputeTotals(client, cart.record.id);

    const reloaded = await loadOrderIn(client, cart.record.order_key);
    if (!reloaded) throw new Error("the cart disappeared while a line was changed");
    return reloaded;
  });

  sendJson(ctx.res, 200, { order: toOrderDto(order, serverToday()) });
}
