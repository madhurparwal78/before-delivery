import { randomUUID } from 'node:crypto';
import { Db, db, tx } from '../db/pool';
import {
  FIELD_COPY,
  alreadyRedeemed,
  cardDeclined,
  emailUnavailable,
  insufficientFunds,
  notFound,
  outOfStock,
  reservationExpired,
  validationFailed
} from '../errors';
import { Ctx, requireUser } from '../http/context';
import { sendJson } from '../http/respond';
import { route } from '../http/router';
import {
  EMAIL_PATTERN,
  FieldErrors,
  PHONE_PATTERN,
  asRecord,
  readBoolean,
  readString,
  validateAddress,
  validateCard,
  validateIdempotencyKey
} from '../http/validate';
import { ensureCart, loadCart, variantLabel } from '../domain/cart';
import { normaliseCode } from '../domain/discounts';
import { giftCardBalance, lockGiftCard, spendGiftCard } from '../domain/giftcards';
import { publishCartCount, publishStockFor } from '../domain/events';
import { runIdempotent } from '../domain/idempotency';
import { CheckoutRow, holdStatus, parseCheckoutRow, releaseHold, reserveLines } from '../domain/holds';
import { orderPlacedSubject, recordNotification } from '../domain/notify';
import {
  addTimeline,
  checkoutPayload,
  checkoutTotals,
  commitHeldLines,
  loadOrder,
  nextOrderNumber,
  orderPayload,
  publishOrder
} from '../domain/orders';
import { cardOutcome, holdExpiresAt } from '../domain/rules';
import { sendMail } from '../services/mailer';

const STEPS = ['contact', 'delivery', 'shipping', 'payment'];

async function loadCheckout(client: Db, id: string, userId: string, lock: boolean): Promise<CheckoutRow> {
  const row = await client.one<Record<string, unknown>>(
    `SELECT * FROM checkouts WHERE id::text = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [id, userId]
  );
  if (row === null) throw notFound();
  const checkout = parseCheckoutRow(row);
  if (checkout.hold_reserved_at === null && checkout.order_number === null) {
    // Codes stay in step with the bag until the hold fixes the checkout.
    const cart = await client.one<{ discount_code: string | null; gift_card_code: string | null }>(
      'SELECT discount_code, gift_card_code FROM carts WHERE user_id = $1',
      [userId]
    );
    if (
      cart !== null &&
      (cart.discount_code !== checkout.discount_code || cart.gift_card_code !== checkout.gift_card_code)
    ) {
      await client.query('UPDATE checkouts SET discount_code = $2, gift_card_code = $3 WHERE id = $1', [
        checkout.id,
        cart.discount_code,
        cart.gift_card_code
      ]);
      checkout.discount_code = cart.discount_code;
      checkout.gift_card_code = cart.gift_card_code;
    }
  }
  return checkout;
}

async function releaseIfLapsed(client: Db, checkout: CheckoutRow, now: Date): Promise<void> {
  if (checkout.hold_reserved_at === null || checkout.hold_released_at !== null) return;
  if (now.getTime() < holdExpiresAt(checkout.hold_reserved_at).getTime()) return;
  await releaseHold(client, checkout, 'hold_lapsed');
  checkout.hold_released_at = new Date();
}

async function checkoutResponse(client: Db, checkout: CheckoutRow): Promise<Record<string, unknown>> {
  const balance = checkout.gift_card_code === null ? 0 : await giftCardBalance(client, checkout.gift_card_code);
  return checkoutPayload(client, checkout, balance, new Date());
}

export function registerCheckoutRoutes(): void {
  route('POST', '/api/checkout', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const payload = await tx(async (client) => {
      const cart = await loadCart(client, { sessionId: ctx.sessionId, userId: user.id });
      if (cart.lines.length === 0) throw validationFailed({ cart: FIELD_COPY.cart });
      const cartRow = await ensureCart(client, { sessionId: ctx.sessionId, userId: user.id });
      const lineRows = await client.query<{ variant_id: string; sku: string; quantity: number }>(
        `SELECT cl.variant_id, v.sku, cl.quantity FROM cart_lines cl
         JOIN variants v ON v.id = cl.variant_id WHERE cl.cart_id = $1
         ORDER BY cl.created_at ASC, cl.id ASC`,
        [cartRow.id]
      );
      const id = randomUUID();
      const lines = lineRows.map((row) => ({
        sku: row.sku,
        variant_id: row.variant_id,
        quantity: row.quantity,
        price: null,
        location: null
      }));
      await client.query(
        `INSERT INTO checkouts (id, user_id, email, shipping_method, discount_code, gift_card_code, lines)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          id,
          user.id,
          user.email,
          cartRow.shipping_method,
          cartRow.discount_code,
          cartRow.gift_card_code,
          JSON.stringify(lines)
        ]
      );
      const checkout = await loadCheckout(client, id, user.id, false);
      return checkoutResponse(client, checkout);
    });
    sendJson(ctx, 201, payload);
  });

  route('GET', '/api/checkout/:id', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const payload = await tx(async (client) => {
      const checkout = await loadCheckout(client, ctx.params.id, user.id, true);
      await releaseIfLapsed(client, checkout, new Date());
      return checkoutResponse(client, checkout);
    });
    sendJson(ctx, 200, payload);
  });

  route('PATCH', '/api/checkout/:id', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const step = readString(ctx.body, 'step') ?? '';
    const goBack = readBoolean(ctx.body, 'go') === true;
    const payload = await tx(async (client) => {
      const checkout = await loadCheckout(client, ctx.params.id, user.id, true);
      await releaseIfLapsed(client, checkout, new Date());

      if (!STEPS.includes(step)) throw validationFailed({ step: 'Choose a checkout step.' });
      if (goBack) {
        await client.query('UPDATE checkouts SET step = $2, version = version + 1 WHERE id = $1', [
          checkout.id,
          step
        ]);
        checkout.step = step;
        return checkoutResponse(client, checkout);
      }

      const errors = new FieldErrors();
      if (step === 'contact') {
        const email = (readString(ctx.body, 'email') ?? '').trim();
        const phone = (readString(ctx.body, 'phone') ?? '').trim();
        if (!EMAIL_PATTERN.test(email)) errors.add('email', FIELD_COPY.email);
        if (!PHONE_PATTERN.test(phone)) errors.add('phone', FIELD_COPY.phone);
        errors.throwIfAny();
        await client.query(
          "UPDATE checkouts SET email = $2, phone = $3, step = 'delivery', version = version + 1 WHERE id = $1",
          [checkout.id, email, phone]
        );
        checkout.email = email;
        checkout.phone = phone;
        checkout.step = 'delivery';
      } else if (step === 'delivery') {
        const addressId = readString(ctx.body, 'address_id');
        let address: Record<string, unknown>;
        if (addressId !== null && addressId !== '') {
          const saved = await client.one<Record<string, unknown>>(
            `SELECT label, name, line1, line2, city, state, postcode, phone FROM addresses
             WHERE id::text = $1 AND user_id = $2 AND deleted = false`,
            [addressId, user.id]
          );
          if (saved === null) throw notFound();
          address = saved;
        } else {
          const input = asRecord(ctx.body.address);
          const validated = validateAddress(input, errors, 'address.');
          errors.throwIfAny();
          address = { label: 'New address', ...validated };
        }
        await client.query(
          "UPDATE checkouts SET address = $2::jsonb, step = 'shipping', version = version + 1 WHERE id = $1",
          [checkout.id, JSON.stringify(address)]
        );
        checkout.address = address;
        checkout.step = 'shipping';
      } else if (step === 'shipping') {
        const method = readString(ctx.body, 'method') ?? '';
        const gift = readBoolean(ctx.body, 'gift') ?? false;
        const giftMessage = readString(ctx.body, 'gift_message') ?? '';
        if (method !== 'standard' && method !== 'express') errors.add('method', FIELD_COPY.method);
        if (giftMessage.length > 200) errors.add('gift_message', FIELD_COPY.giftMessage);
        errors.throwIfAny();
        await client.query(
          `UPDATE checkouts SET shipping_method = $2, shipping_chosen = true, gift = $3, gift_message = $4,
                                step = 'payment', version = version + 1 WHERE id = $1`,
          [checkout.id, method, gift, giftMessage]
        );
        const cartRow = await ensureCart(client, { sessionId: ctx.sessionId, userId: user.id });
        await client.query('UPDATE carts SET shipping_method = $2 WHERE id = $1', [cartRow.id, method]);
        checkout.shipping_method = method;
        checkout.gift = gift;
        checkout.gift_message = giftMessage;
        checkout.step = 'payment';
      } else {
        await client.query("UPDATE checkouts SET step = 'payment', version = version + 1 WHERE id = $1", [
          checkout.id
        ]);
        checkout.step = 'payment';
      }
      return checkoutResponse(client, checkout);
    });
    sendJson(ctx, 200, payload);
  });

  route('POST', '/api/checkout/:id/reserve', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const payload = await reserveCheckout(ctx.params.id, user.id);
    sendJson(ctx, 200, payload);
  });

  route('POST', '/api/orders', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const key = validateIdempotencyKey(ctx.request.headers['idempotency-key'] as string | undefined, true);
    const checkoutId = readString(ctx.body, 'checkout_id') ?? '';

    const result = await runIdempotent(key, user.id, 'POST /api/orders', ctx.body, async () => {
      const existing = await tx((client) => loadCheckout(client, checkoutId, user.id, false));
      if (existing.order_number !== null) {
        const order = await loadOrder(db, existing.order_number);
        if (order === null) throw notFound();
        return { status: 201, payload: await orderPayload(db, order, new Date()) };
      }

      await reserveCheckout(checkoutId, user.id);

      const amountDue = await tx(async (client) => {
        const checkout = await loadCheckout(client, checkoutId, user.id, false);
        const balance =
          checkout.gift_card_code === null ? 0 : await giftCardBalance(client, checkout.gift_card_code);
        const computed = await checkoutTotals(client, checkout, balance);
        return computed.totals.total;
      });

      let cardLast4: string | null = null;
      if (amountDue > 0) {
        const errors = new FieldErrors();
        const card = validateCard(asRecord(ctx.body.card), errors, new Date());
        errors.throwIfAny();
        const outcome = cardOutcome(card.number);
        if (outcome !== 'authorized') {
          await db.query("UPDATE checkouts SET payment_state = 'failed' WHERE id::text = $1", [checkoutId]);
          throw outcome === 'card_declined' ? cardDeclined() : insufficientFunds();
        }
        cardLast4 = card.number.slice(-4);
      }

      const order = await placeOrder(ctx, checkoutId, user.id, cardLast4);
      return { status: 201, payload: order };
    });

    sendJson(ctx, result.status, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
  });
}

async function reserveCheckout(checkoutId: string, userId: string): Promise<Record<string, unknown>> {
  return tx(async (client) => {
    const checkout = await loadCheckout(client, checkoutId, userId, true);
    const now = new Date();
    await releaseIfLapsed(client, checkout, now);

    const status = holdStatus(checkout, now);
    if (status.status === 'active') {
      return { hold: status };
    }
    if (checkout.hold_reserved_at !== null && checkout.order_number === null && status.status === 'expired') {
      throw reservationExpired();
    }

    const outcome = await reserveLines(client, checkout);
    if (!outcome.ok) {
      const variant = await client.one<{ product: string; colour: string; size: string }>(
        `SELECT p.name AS product, v.colour, v.size FROM variants v
         JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
        [outcome.failure.variantId]
      );
      throw outOfStock(
        outcome.failure.sku,
        outcome.failure.available,
        variantLabel(variant!.product, variant!.colour, variant!.size)
      );
    }

    const balance = checkout.gift_card_code === null ? 0 : await giftCardBalance(client, checkout.gift_card_code);
    const computed = await checkoutTotals(client, checkout, balance);
    for (const line of checkout.lines) {
      const detail = computed.lines.find((item) => item.variant_id === line.variant_id);
      line.price = detail?.unit_price ?? null;
    }
    await client.query(
      'UPDATE checkouts SET hold_reserved_at = now(), hold_released_at = NULL, lines = $2::jsonb WHERE id = $1',
      [checkout.id, JSON.stringify(checkout.lines)]
    );
    await publishStockFor(client, checkout.lines.map((line) => line.variant_id));
    const fresh = await loadCheckout(client, checkoutId, userId, false);
    return { hold: holdStatus(fresh, new Date()) };
  });
}

async function placeOrder(
  ctx: Ctx,
  checkoutId: string,
  userId: string,
  cardLast4: string | null
): Promise<Record<string, unknown>> {
  return tx(async (client) => {
    const checkout = await loadCheckout(client, checkoutId, userId, true);
    const now = new Date();
    if (checkout.order_number !== null) {
      const existing = await loadOrder(client, checkout.order_number);
      return orderPayload(client, existing!, now);
    }
    if (holdStatus(checkout, now).status !== 'active') throw reservationExpired();

    let balance = 0;
    if (checkout.gift_card_code !== null) {
      await lockGiftCard(client, checkout.gift_card_code);
      balance = await giftCardBalance(client, checkout.gift_card_code);
    }
    const computed = await checkoutTotals(client, checkout, balance);
    if (checkout.gift_card_code !== null && computed.totals.gift_card > balance) {
      throw alreadyRedeemed(balance);
    }

    const number = await nextOrderNumber(client);
    await commitHeldLines(client, checkout, number);
    await client.query('UPDATE checkouts SET hold_released_at = now(), order_number = $2 WHERE id = $1', [
      checkout.id,
      number
    ]);

    if (checkout.gift_card_code !== null && computed.totals.gift_card > 0) {
      await spendGiftCard(client, checkout.gift_card_code, computed.totals.gift_card, number);
    }
    if (checkout.discount_code !== null) {
      await client.query('UPDATE discount_codes SET used = used + 1 WHERE code = $1', [
        normaliseCode(checkout.discount_code)
      ]);
    }

    const user = await client.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    await client.query(
      `INSERT INTO orders (number, user_id, kind, status, payment_status, placed_at, email, phone, address,
                           shipping_method, gift, gift_message, discount_code, gift_card_code, totals,
                           shipping_tax, payment_amount, card_amount, gift_card_amount, card_last4)
       VALUES ($1, $2, 'standard', 'placed', 'captured', $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11,
               $12::jsonb, $13, $14, $15, $16, $17)`,
      [
        number,
        userId,
        now,
        checkout.email ?? user!.email,
        checkout.phone,
        JSON.stringify(checkout.address),
        checkout.shipping_method,
        checkout.gift,
        checkout.gift_message,
        checkout.discount_code === null ? null : normaliseCode(checkout.discount_code),
        checkout.gift_card_code,
        JSON.stringify(computed.totals),
        computed.shipping_tax,
        computed.grand_total,
        computed.totals.total,
        computed.totals.gift_card,
        cardLast4
      ]
    );
    await addTimeline(client, number, 'placed', now);
    for (const [index, line] of computed.lines.entries()) {
      await client.query(
        `INSERT INTO order_lines (id, order_number, variant_id, sku, product, product_slug, category, colour, size,
                                  quantity, unit_price, line_subtotal, line_discount, line_tax, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          randomUUID(),
          number,
          line.variant_id,
          line.sku,
          line.product,
          line.product_slug,
          line.category,
          line.colour,
          line.size,
          line.quantity,
          line.unit_price,
          line.line_subtotal,
          line.line_discount,
          line.line_tax,
          index + 1
        ]
      );
    }

    const subject = orderPlacedSubject(number);
    const body = `Order ${number} is placed.\nTotal paid: ${computed.totals.total}`;
    try {
      await sendMail({ to: checkout.email ?? user!.email, subject, body });
    } catch {
      throw emailUnavailable();
    }
    await client.query('UPDATE orders SET confirmation_emailed_at = $2 WHERE number = $1', [number, new Date()]);
    await recordNotification(client, userId, subject, body, 'emailed');

    const cartRow = await ensureCart(client, { sessionId: ctx.sessionId, userId });
    await client.query('DELETE FROM cart_lines WHERE cart_id = $1', [cartRow.id]);
    await client.query(
      "UPDATE carts SET discount_code = NULL, gift_card_code = NULL, shipping_method = 'standard' WHERE id = $1",
      [cartRow.id]
    );
    await publishCartCount(client, userId, 0);
    await publishStockFor(client, checkout.lines.map((line) => line.variant_id));

    const order = await loadOrder(client, number);
    await publishOrder(client, order!);
    return orderPayload(client, order!, new Date());
  });
}

export { loadCheckout, releaseIfLapsed };
