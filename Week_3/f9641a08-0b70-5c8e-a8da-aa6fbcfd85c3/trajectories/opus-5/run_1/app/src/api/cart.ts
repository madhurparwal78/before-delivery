import { randomUUID } from 'node:crypto';
import { tx } from '../db/pool';
import { FIELD_COPY, alreadyRedeemed, codeInvalid, notFound, outOfStock, unauthenticated, validationFailed } from '../errors';
import { sendJson } from '../http/respond';
import { route } from '../http/router';
import { FieldErrors, readInteger, readString } from '../http/validate';
import { ensureCart, loadCart, Owner, variantLabel } from '../domain/cart';
import { assertDiscountUsable, isGiftCardCode, loadDiscount, normaliseCode } from '../domain/discounts';
import { giftCardBalance, giftCardExists } from '../domain/giftcards';
import { publishCartCount } from '../domain/events';
import { availableMap } from '../domain/stock';

function ownerOf(sessionId: string, userId: string | null): Owner {
  return { sessionId, userId };
}

export function registerCartRoutes(): void {
  route('GET', '/api/cart', 'api', async (ctx) => {
    const cart = await tx((client) => loadCart(client, ownerOf(ctx.sessionId, ctx.user?.id ?? null)));
    sendJson(ctx, 200, cart);
  });

  route('POST', '/api/cart/lines', 'api', async (ctx) => {
    const errors = new FieldErrors();
    const sku = readString(ctx.body, 'sku') ?? '';
    const quantity = readInteger(ctx.body, 'quantity');
    if (sku.trim() === '') errors.add('sku', FIELD_COPY.sku);
    if (quantity === null || quantity < 1 || quantity > 10) errors.add('quantity', FIELD_COPY.quantity);
    errors.throwIfAny();

    const cart = await tx(async (client) => {
      const variant = await client.one<{ id: string; colour: string; size: string; product: string }>(
        `SELECT v.id, v.colour, v.size, p.name AS product FROM variants v
         JOIN products p ON p.id = v.product_id WHERE v.sku = $1 AND p.status = 'published'`,
        [sku]
      );
      if (variant === null) throw validationFailed({ sku: FIELD_COPY.sku });
      const owner = ownerOf(ctx.sessionId, ctx.user?.id ?? null);
      const row = await ensureCart(client, owner);
      const available = (await availableMap(client, [variant.id])).get(variant.id) ?? 0;
      if (available <= 0) {
        throw outOfStock(sku, 0, variantLabel(variant.product, variant.colour, variant.size));
      }
      const existing = await client.one<{ id: string; quantity: number }>(
        'SELECT id, quantity FROM cart_lines WHERE cart_id = $1 AND variant_id = $2',
        [row.id, variant.id]
      );
      const wanted = (existing?.quantity ?? 0) + (quantity as number);
      const capped = Math.min(wanted, available, 10);
      if (existing === null) {
        await client.query('INSERT INTO cart_lines (id, cart_id, variant_id, quantity) VALUES ($1, $2, $3, $4)', [
          randomUUID(),
          row.id,
          variant.id,
          capped
        ]);
      } else {
        await client.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [existing.id, capped]);
      }
      const notices = capped < wanted ? [`Only ${capped} left — we updated your bag.`] : [];
      const view = await loadCart(client, owner, notices);
      await publishCartCount(client, owner.userId, view.count);
      return view;
    });
    sendJson(ctx, 200, cart);
  });

  route('PATCH', '/api/cart/lines/:id', 'api', async (ctx) => {
    const quantity = readInteger(ctx.body, 'quantity');
    const cart = await tx(async (client) => {
      const owner = ownerOf(ctx.sessionId, ctx.user?.id ?? null);
      const row = await ensureCart(client, owner);
      const line = await client.one<{ id: string; variant_id: string }>(
        'SELECT id, variant_id FROM cart_lines WHERE id::text = $1 AND cart_id = $2',
        [ctx.params.id, row.id]
      );
      if (line === null) throw notFound();
      if (quantity === null || quantity < 1 || quantity > 10) {
        throw validationFailed({ quantity: FIELD_COPY.quantity });
      }
      const available = (await availableMap(client, [line.variant_id])).get(line.variant_id) ?? 0;
      const capped = Math.min(quantity, Math.max(available, 0));
      const notices: string[] = [];
      if (capped < quantity) notices.push(`Only ${capped} left — we updated your bag.`);
      if (capped <= 0) {
        await client.query('DELETE FROM cart_lines WHERE id = $1', [line.id]);
      } else {
        await client.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [line.id, capped]);
      }
      const view = await loadCart(client, owner, notices);
      await publishCartCount(client, owner.userId, view.count);
      return view;
    });
    sendJson(ctx, 200, cart);
  });

  route('DELETE', '/api/cart/lines/:id', 'api', async (ctx) => {
    const cart = await tx(async (client) => {
      const owner = ownerOf(ctx.sessionId, ctx.user?.id ?? null);
      const row = await ensureCart(client, owner);
      const line = await client.one<{ id: string }>(
        'SELECT id FROM cart_lines WHERE id::text = $1 AND cart_id = $2',
        [ctx.params.id, row.id]
      );
      if (line === null) throw notFound();
      await client.query('DELETE FROM cart_lines WHERE id = $1', [line.id]);
      const view = await loadCart(client, owner);
      await publishCartCount(client, owner.userId, view.count);
      return view;
    });
    sendJson(ctx, 200, cart);
  });

  route('POST', '/api/cart/codes', 'api', async (ctx) => {
    const raw = readString(ctx.body, 'code') ?? '';
    if (raw.trim() === '') throw validationFailed({ code: FIELD_COPY.code });
    const code = normaliseCode(raw);

    const cart = await tx(async (client) => {
      const owner = ownerOf(ctx.sessionId, ctx.user?.id ?? null);
      const row = await ensureCart(client, owner);

      if (isGiftCardCode(code)) {
        if (owner.userId === null) throw unauthenticated();
        if (!(await giftCardExists(client, code))) throw codeInvalid();
        const balance = await giftCardBalance(client, code);
        if (balance <= 0) throw alreadyRedeemed(balance);
        await client.query('UPDATE carts SET gift_card_code = $2 WHERE id = $1', [row.id, code]);
        return loadCart(client, owner);
      }

      const current = await loadCart(client, owner);
      const discountRow = await loadDiscount(client, code);
      const collection = discountRow?.collection ?? null;
      const eligibleLines = await client.query<{ total: string }>(
        `SELECT coalesce(sum(v.price * cl.quantity), 0)::bigint AS total
         FROM cart_lines cl JOIN variants v ON v.id = cl.variant_id JOIN products p ON p.id = v.product_id
         WHERE cl.cart_id = $1 AND ($2::text IS NULL OR p.category = $2)`,
        [row.id, collection]
      );
      const eligibleSubtotal = Number(eligibleLines[0]?.total ?? 0);
      const hasEligible = eligibleSubtotal > 0 && current.lines.length > 0;
      assertDiscountUsable(discountRow, new Date(), eligibleSubtotal, hasEligible);
      await client.query('UPDATE carts SET discount_code = $2 WHERE id = $1', [row.id, code]);
      return loadCart(client, owner);
    });
    sendJson(ctx, 200, cart);
  });

  route('DELETE', '/api/cart/discount', 'api', async (ctx) => {
    const cart = await tx(async (client) => {
      const owner = ownerOf(ctx.sessionId, ctx.user?.id ?? null);
      const row = await ensureCart(client, owner);
      await client.query('UPDATE carts SET discount_code = NULL WHERE id = $1', [row.id]);
      return loadCart(client, owner);
    });
    sendJson(ctx, 200, cart);
  });

  route('DELETE', '/api/cart/gift-card', 'api', async (ctx) => {
    const cart = await tx(async (client) => {
      const owner = ownerOf(ctx.sessionId, ctx.user?.id ?? null);
      const row = await ensureCart(client, owner);
      await client.query('UPDATE carts SET gift_card_code = NULL WHERE id = $1', [row.id]);
      return loadCart(client, owner);
    });
    sendJson(ctx, 200, cart);
  });
}
