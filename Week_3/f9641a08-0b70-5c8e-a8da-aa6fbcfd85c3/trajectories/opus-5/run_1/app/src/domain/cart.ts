import { randomUUID } from 'node:crypto';
import { Db } from '../db/pool';
import { rupees } from './money';
import { discountStillApplies, loadDiscount, normaliseCode } from './discounts';
import { giftCardBalance } from './giftcards';
import { publishCartCount } from './events';
import { computeTotals, stockBadge, TotalsDiscount } from './rules';
import { availableMap } from './stock';

export type Owner = { sessionId: string; userId: string | null };

export type CartLineView = {
  id: string;
  sku: string;
  product: string;
  colour: string;
  size: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_discount: number;
  available: number;
  badge: string;
};

export type CartView = {
  count: number;
  lines: CartLineView[];
  discount: { code: string; kind: string; value: number } | null;
  gift_card: { last4: string; balance: number } | null;
  shipping_method: string;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  notices: string[];
};

export type CartRow = {
  id: string;
  shipping_method: string;
  discount_code: string | null;
  gift_card_code: string | null;
};

export async function ensureCart(client: Db, owner: Owner): Promise<CartRow> {
  const existing =
    owner.userId === null
      ? await client.one<CartRow>(
          'SELECT id, shipping_method, discount_code, gift_card_code FROM carts WHERE session_id = $1',
          [owner.sessionId]
        )
      : await client.one<CartRow>(
          'SELECT id, shipping_method, discount_code, gift_card_code FROM carts WHERE user_id = $1',
          [owner.userId]
        );
  if (existing !== null) return existing;
  const id = randomUUID();
  await client.query(
    `INSERT INTO carts (id, session_id, user_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [id, owner.userId === null ? owner.sessionId : null, owner.userId]
  );
  const created =
    owner.userId === null
      ? await client.one<CartRow>(
          'SELECT id, shipping_method, discount_code, gift_card_code FROM carts WHERE session_id = $1',
          [owner.sessionId]
        )
      : await client.one<CartRow>(
          'SELECT id, shipping_method, discount_code, gift_card_code FROM carts WHERE user_id = $1',
          [owner.userId]
        );
  if (created === null) throw new Error('cart could not be created');
  return created;
}

type LineRow = {
  id: string;
  variant_id: string;
  quantity: number;
  sku: string;
  colour: string;
  size: string;
  price: number;
  product: string;
  category: string;
  created_at: Date;
};

export function variantLabel(product: string, colour: string, size: string): string {
  return `${product} — ${colour}, ${size}`;
}

export async function loadCart(client: Db, owner: Owner, extraNotices: string[] = []): Promise<CartView> {
  const cart = await ensureCart(client, owner);
  const notices = [...extraNotices];

  const lines = await client.query<LineRow>(
    `SELECT cl.id, cl.variant_id, cl.quantity, cl.created_at, v.sku, v.colour, v.size, v.price,
            p.name AS product, p.category
     FROM cart_lines cl
     JOIN variants v ON v.id = cl.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE cl.cart_id = $1
     ORDER BY cl.created_at ASC, cl.id ASC`,
    [cart.id]
  );

  const available = await availableMap(client, lines.map((line) => line.variant_id));
  const kept: LineRow[] = [];
  for (const line of lines) {
    const units = available.get(line.variant_id) ?? 0;
    if (units <= 0) {
      await client.query('DELETE FROM cart_lines WHERE id = $1', [line.id]);
      notices.push(`Only 0 left — we updated your bag.`);
      continue;
    }
    if (line.quantity > units) {
      await client.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [line.id, units]);
      line.quantity = units;
      notices.push(`Only ${units} left — we updated your bag.`);
    }
    kept.push(line);
  }

  const now = new Date();
  let discount: TotalsDiscount | null = null;
  if (cart.discount_code !== null) {
    const row = await loadDiscount(client, cart.discount_code);
    const candidate: TotalsDiscount | null =
      row === null ? null : { code: row.code, kind: row.kind, value: row.value, collection: row.collection };
    const eligibleLines = kept.filter(
      (line) => candidate !== null && (candidate.collection === null || line.category === candidate.collection)
    );
    const eligibleSubtotal = eligibleLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    if (discountStillApplies(row, now, eligibleSubtotal, eligibleLines.length > 0)) {
      discount = candidate;
    } else {
      await client.query('UPDATE carts SET discount_code = NULL WHERE id = $1', [cart.id]);
      notices.push(`Code ${normaliseCode(cart.discount_code)} no longer applies and was removed.`);
      cart.discount_code = null;
    }
  }

  let giftCard: { last4: string; balance: number } | null = null;
  let giftBalance = 0;
  if (cart.gift_card_code !== null) {
    giftBalance = await giftCardBalance(client, cart.gift_card_code);
    giftCard = { last4: normaliseCode(cart.gift_card_code).slice(-4), balance: giftBalance };
  }

  const shippingMethod = cart.shipping_method === 'express' ? 'express' : 'standard';
  const result = computeTotals({
    lines: kept.map((line) => ({
      sku: line.sku,
      category: line.category,
      unit_price: line.price,
      quantity: line.quantity
    })),
    discount,
    shippingMethod,
    giftCardBalance: giftBalance
  });

  return {
    count: kept.reduce((sum, line) => sum + line.quantity, 0),
    lines: kept.map((line, index) => ({
      id: line.id,
      sku: line.sku,
      product: line.product,
      colour: line.colour,
      size: line.size,
      quantity: line.quantity,
      unit_price: line.price,
      line_subtotal: result.lines[index].line_subtotal,
      line_discount: result.lines[index].line_discount,
      available: available.get(line.variant_id) ?? 0,
      badge: stockBadge(available.get(line.variant_id) ?? 0)
    })),
    discount: discount === null ? null : { code: discount.code, kind: discount.kind, value: discount.value },
    gift_card: giftCard,
    shipping_method: shippingMethod,
    totals: result.totals,
    notices
  };
}

export async function announceCart(client: Db, owner: Owner, cart: CartView): Promise<void> {
  await publishCartCount(client, owner.userId, cart.count);
}

export function giftCardRemainderCopy(balance: number, spent: number): string {
  return `Gift card balance after this order: ${rupees(Math.max(0, balance - spent))}`;
}
