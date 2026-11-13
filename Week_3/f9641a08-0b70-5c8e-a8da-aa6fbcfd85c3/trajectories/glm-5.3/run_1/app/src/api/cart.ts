import type { Client } from '../db/pool.js';
import { Router } from 'express';
import { h } from './h.js';
import { pool, withClient, inTransaction } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors, dateText, rupeeText } from '../domain/errors.js';
import { readSession, requireSignedIn, type SessionInfo } from './session.js';
import { publish } from '../domain/events.js';
import { availableFor } from '../domain/ledger.js';
import { computeTotals, type CartLineInput, type AppliedCode } from '../domain/totals.js';
import { giftCardBalance, canonicalToken } from './account.js';

export const cartRouter = Router();

type CartRow = { id: string; sku: string; quantity: number; product: string; colour: string; size: string; collection: string; unit_price: number; compare_at: number | null };

export async function loadCartRow(client: Client, token: string): Promise<{ id: number; discount_code: string | null; gift_card_code: string | null; shipping_method: 'standard' | 'express' } | null> {
  const res = await client.query<{ id: string; discount_code: string | null; gift_card_code: string | null; shipping_method: 'standard' | 'express' }>(
    `SELECT id::TEXT AS id, discount_code, gift_card_code, shipping_method FROM carts WHERE session_token = $1`, [await canonicalTokenFor(client, token)]);
  if (res.rows.length === 0) return null;
  return { id: Number(res.rows[0].id), discount_code: res.rows[0].discount_code, gift_card_code: res.rows[0].gift_card_code, shipping_method: res.rows[0].shipping_method };
}

/** Any session of an account shares the account's canonical session for bag lookups. */
async function canonicalTokenFor(client: Client, token: string): Promise<string> {
  const session = await client.query<{ user_id: string | null }>(`SELECT user_id::TEXT AS user_id FROM sessions WHERE token = $1`, [token]);
  const userId = session.rows[0]?.user_id;
  if (userId === null || userId === undefined) return token;
  const canonical = await client.query<{ token: string }>(
    `SELECT token FROM sessions WHERE user_id = $1 ORDER BY created_at, token LIMIT 1`, [Number(userId)]);
  return canonical.rows[0]?.token ?? token;
}

export async function ensureCart(client: Client, session: SessionInfo): Promise<number> {
  const token = await canonicalToken(client, session);
  const existing = await loadCartRow(client, token);
  if (existing) return existing.id;
  const res = await client.query<{ id: string }>(
    `INSERT INTO carts (session_token, user_id) VALUES ($1, $2) RETURNING id::TEXT AS id`,
    [token, session.userId]);
  return Number(res.rows[0].id);
}

/** The bag read path, with clamp and code re-check, publishing live events. */
export async function readCart(session: SessionInfo): Promise<Record<string, unknown>> {
  return inTransaction(async (client) => {
    const cartId = await ensureCart(client, session);
    await clampLines(client, cartId, session);
    return await cartBody(client, cartId, session);
  });
}

export async function cartBody(client: Client, cartId: number, session: SessionInfo, notices: string[] = []): Promise<Record<string, unknown>> {
  const cart = await client.query<{ discount_code: string | null; gift_card_code: string | null; shipping_method: 'standard' | 'express' }>(
    `SELECT discount_code, gift_card_code, shipping_method FROM carts WHERE id = $1`, [cartId]);
  if (cart.rows.length === 0) throw Errors.notFound();
  const head = cart.rows[0];
  const lines = await client.query<CartRow>(`
    SELECT l.id::TEXT AS id, l.sku, l.quantity, p.name AS product, v.colour, v.size, p.category AS collection, v.price AS unit_price, v.compare_at
    FROM cart_lines l
    JOIN variants v ON v.sku = l.sku
    JOIN products p ON p.slug = v.product_slug
    WHERE l.cart_id = $1 ORDER BY l.id`, [cartId]);
  const skus = lines.rows.map((l) => l.sku);
  const availability = await availableFor(client, skus);

  const code = head.discount_code === null ? null : await loadCode(client, head.discount_code);
  const giftBalance = head.gift_card_code === null ? null : await giftCardBalanceTx(client, head.gift_card_code);
  const inputs: CartLineInput[] = lines.rows.map((l) => ({
    sku: l.sku, product: l.product, collection: l.collection, unit_price: l.unit_price, quantity: l.quantity,
  }));
  const { lines: computed, totals } = computeTotals(inputs, code, head.shipping_method, giftBalance);

  const outLines = lines.rows.map((l, i) => ({
    id: Number(l.id),
    sku: l.sku,
    product: l.product,
    colour: l.colour,
    size: l.size,
    quantity: l.quantity,
    unit_price: l.unit_price,
    line_subtotal: computed[i].line_subtotal,
    line_discount: computed[i].line_discount,
    available: availability.get(l.sku) ?? 0,
    badge: stockBadgeOf(availability.get(l.sku) ?? 0),
  }));
  return {
    count: lines.rows.reduce((sum, l) => sum + l.quantity, 0),
    lines: outLines,
    discount: code === null ? null : { code: code.code, kind: code.kind, value: code.value },
    gift_card: head.gift_card_code === null || giftBalance === null ? null : { last4: head.gift_card_code.slice(-4), balance: giftBalance },
    shipping_method: head.shipping_method,
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      tax: totals.tax,
      gift_card: totals.gift_card,
      total: totals.total,
    },
    notices,
  };
}

function stockBadgeOf(available: number): string {
  if (available <= 0) return 'Out of stock';
  if (available <= CONFIG.lowStockThreshold) return `Only ${available} left`;
  return 'In stock';
}

async function giftCardBalanceTx(client: Client, code: string): Promise<number | null> {
  const card = await client.query(`SELECT code FROM gift_cards WHERE code = $1`, [code]);
  if (card.rows.length === 0) return null;
  const res = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0)::TEXT AS balance FROM gift_card_ledger WHERE code = $1`, [code]);
  return Number(res.rows[0].balance);
}

async function loadCode(client: Client, code: string): Promise<AppliedCode> {
  const res = await client.query<{ code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number; starts_at: Date; ends_at: Date; usage_limit: number | null; used: number }>(
    `SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes WHERE UPPER(code) = UPPER($1)`, [code]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const now = new Date();
  if (now < row.starts_at) return null;
  if (now >= row.ends_at) return null;
  if (row.usage_limit !== null && row.used >= row.usage_limit) return null;
  return { code: row.code, kind: row.kind, value: row.value, collection: row.collection, minimum: row.minimum };
}

/** Clamp lines to availability, answering notices when quantities fall. */
export async function clampLines(client: Client, cartId: number, session: SessionInfo): Promise<void> {
  const lines = await client.query<{ id: string; sku: string; quantity: number }>(
    `SELECT id::TEXT AS id, sku, quantity FROM cart_lines WHERE cart_id = $1`, [cartId]);
  for (const line of lines.rows) {
    const available = await availableFor(client, [line.sku]);
    const have = available.get(line.sku) ?? 0;
    if (line.quantity > have) {
      if (have <= 0) {
        await client.query(`DELETE FROM cart_lines WHERE id = $1`, [Number(line.id)]);
        await client.query(`UPDATE carts SET discount_code = NULL, gift_card_code = NULL WHERE id = $1`, [cartId]);
      } else {
        await client.query(`UPDATE cart_lines SET quantity = $1 WHERE id = $2`, [have, Number(line.id)]);
      }
    }
  }
}

cartRouter.get('/cart', h(async (req, res) => {
  const session = await readSession(req, res);
  res.status(200).json(await readCart(session));
}));

cartRouter.post('/cart/lines', h(async (req, res) => {
  const session = await readSession(req, res);
  const body = req.body as { sku?: unknown; quantity?: unknown };
  const fields: Record<string, string> = {};
  const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
  const quantity = Number(body.quantity ?? 1);
  if (sku === '') fields.sku = 'Choose a variant from the catalogue.';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) fields.quantity = 'Choose a quantity from 1 to 10.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

  const result = await inTransaction(async (client) => {
    const variant = await client.query<{ sku: string }>(
      `SELECT v.sku FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1 AND p.status = 'published'`, [sku]);
    if (variant.rows.length === 0) {
      throw Errors.validationFailed({ sku: 'Choose a variant from the catalogue.' });
    }
    const cartId = await ensureCart(client, session);
    await client.query('SELECT 1'); // no-op keepalive
    const available = await availableForTx(client, [sku]);
    const have = available.get(sku) ?? 0;
    if (have <= 0) {
      const info = await client.query<{ name: string; colour: string; size: string }>(
        `SELECT p.name, v.colour, v.size FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [sku]);
      const v = info.rows[0];
      throw Errors.outOfStockGone(`${v.name} — ${v.colour}, ${v.size}`);
    }
    const existing = await client.query<{ id: string; quantity: number }>(
      `SELECT id::TEXT AS id, quantity FROM cart_lines WHERE cart_id = $1 AND sku = $2`, [cartId, sku]);
    const wanted = (existing.rows.length > 0 ? existing.rows[0].quantity : 0) + quantity;
    const finalQty = Math.min(10, wanted, have);
    if (existing.rows.length > 0) {
      await client.query(`UPDATE cart_lines SET quantity = $1 WHERE id = $2`, [finalQty, Number(existing.rows[0].id)]);
    } else {
      await client.query(`INSERT INTO cart_lines (cart_id, sku, quantity) VALUES ($1,$2,$3)`, [cartId, sku, finalQty]);
    }
    const notices: string[] = [];
    if (wanted > finalQty && have > 0) {
      notices.push(`Only ${have} left — we updated your bag.`);
    }
    await publishCart(client, session, cartId);
    const body = await cartBody(client, cartId, session, notices);
    return body;
  });
  res.status(200).json(result);
}));

async function availableForTx(client: Client, skus: string[]): Promise<Map<string, number>> {
  if (skus.length === 0) return new Map();
  const res = await client.query<{ sku: string; available: string }>(
    `SELECT sku, COALESCE(SUM(quantity), 0)::TEXT AS available FROM stock_entries WHERE sku = ANY($1) AND account = 'available' GROUP BY sku`, [skus]);
  return new Map(res.rows.map((r) => [r.sku, Number(r.available)]));
}

cartRouter.patch('/cart/lines/:id', h(async (req, res) => {
  const session = await readSession(req, res);
  const lineId = Number(req.params.id);
  const body = req.body as { quantity?: unknown };
  const quantity = Number(body.quantity);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) fields.quantity = 'Choose a quantity from 1 to 10.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

  const result = await inTransaction(async (client) => {
    const cart = await loadCartRow(client, session.token);
    if (cart === null) throw Errors.notFound();
    const line = await client.query<{ id: string; sku: string }>(
      `SELECT id::TEXT AS id, sku FROM cart_lines WHERE id = $1 AND cart_id = $2`, [lineId, cart.id]);
    if (line.rows.length === 0) throw Errors.notFound();
    const available = await availableForTx(client, [line.rows[0].sku]);
    const have = available.get(line.rows[0].sku) ?? 0;
    const finalQty = Math.min(quantity, have);
    await client.query(`UPDATE cart_lines SET quantity = $1 WHERE id = $2`, [finalQty, lineId]);
    const notices: string[] = [];
    if (quantity > have && have > 0) notices.push(`Only ${have} left — we updated your bag.`);
    await publishCart(client, session, cart.id);
    return await cartBody(client, cart.id, session, notices);
  });
  res.status(200).json(result);
}));

cartRouter.delete('/cart/lines/:id', h(async (req, res) => {
  const session = await readSession(req, res);
  const lineId = Number(req.params.id);
  const result = await inTransaction(async (client) => {
    const cart = await loadCartRow(client, session.token);
    if (cart === null) throw Errors.notFound();
    const line = await client.query(`SELECT id FROM cart_lines WHERE id = $1 AND cart_id = $2`, [lineId, cart.id]);
    if (line.rows.length === 0) throw Errors.notFound();
    await client.query(`DELETE FROM cart_lines WHERE id = $1`, [lineId]);
    await publishCart(client, session, cart.id);
    return await cartBody(client, cart.id, session);
  });
  res.status(200).json(result);
}));

async function publishCart(client: Client, session: SessionInfo, cartId: number): Promise<void> {
  const res = await client.query<{ count: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::TEXT AS count FROM cart_lines WHERE cart_id = $1`, [cartId]);
  await publish(client, 'cart', { count: Number(res.rows[0].count) },
    { userId: session.userId, sessionId: session.token, staffVisible: false });
}

cartRouter.post('/cart/codes', h(async (req, res) => {
  const session = await readSession(req, res);
  const raw = typeof (req.body as { code?: unknown }).code === 'string' ? String((req.body as { code: string }).code) : '';
  const code = raw.trim();
  if (code === '') throw Errors.validationFailed({ code: 'Enter a code.' });
  const upper = code.toUpperCase();
  const result = await inTransaction(async (client) => {
    const cartId = await ensureCart(client, session);
    if (upper.startsWith('RHGC-')) {
      if (session.userId === null) throw Errors.unauthenticated();
      const balance = await giftCardBalanceTx(client, upper);
      if (balance === null) throw Errors.codeInvalid();
      if (balance <= 0) throw Errors.alreadyRedeemed(balance);
      await client.query(`UPDATE carts SET gift_card_code = $1 WHERE id = $2`, [upper, cartId]);
      await publishCart(client, session, cartId);
      return await cartBody(client, cartId, session);
    }
    const check = await checkDiscountCode(client, upper, cartId);
    const applied = check.code;
    if (applied === null) throw Errors.codeInvalid();
    await client.query(`UPDATE carts SET discount_code = $1 WHERE id = $2`, [applied.code, cartId]);
    await publishCart(client, session, cartId);
    return await cartBody(client, cartId, session);
  });
  res.status(200).json(result);
}));

/** The one place discount code eligibility is decided, in the published order. */
export async function checkDiscountCode(client: Client, upper: string, cartId: number): Promise<{ code: AppliedCode }> {
  const res = await client.query<{ code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number; starts_at: Date; ends_at: Date; usage_limit: number | null; used: number }>(
    `SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes WHERE UPPER(code) = $1`, [upper]);
  if (res.rows.length === 0) throw Errors.codeInvalid();
  const row = res.rows[0];
  const now = new Date();
  if (now < row.starts_at) throw Errors.codeInvalid();
  if (now >= row.ends_at) throw Errors.codeExpired(dateText(row.ends_at));
  if (row.usage_limit !== null && row.used >= row.usage_limit) throw Errors.codeExhausted();
  const lines = await client.query<{ collection: string; unit_price: number; quantity: number }>(`
    SELECT p.category AS collection, v.price AS unit_price, l.quantity
    FROM cart_lines l JOIN variants v ON v.sku = l.sku JOIN products p ON p.slug = v.product_slug
    WHERE l.cart_id = $1`, [cartId]);
  const eligible = lines.rows.filter((l) => row.collection === null || row.collection === l.collection);
  if (eligible.length === 0) throw Errors.codeNotApplicable();
  const subtotal = eligible.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  if (subtotal < row.minimum) throw Errors.minimumNotMet(row.minimum - subtotal);
  return { code: { code: row.code, kind: row.kind, value: row.value, collection: row.collection, minimum: row.minimum } };
}

cartRouter.delete('/cart/discount', h(async (req, res) => {
  const session = await readSession(req, res);
  const result = await inTransaction(async (client) => {
    const cartId = await ensureCart(client, session);
    await client.query(`UPDATE carts SET discount_code = NULL WHERE id = $1`, [cartId]);
    await publishCart(client, session, cartId);
    return await cartBody(client, cartId, session);
  });
  res.status(200).json(result);
}));

cartRouter.delete('/cart/gift-card', h(async (req, res) => {
  const session = await readSession(req, res);
  const result = await inTransaction(async (client) => {
    const cartId = await ensureCart(client, session);
    await client.query(`UPDATE carts SET gift_card_code = NULL WHERE id = $1`, [cartId]);
    await publishCart(client, session, cartId);
    return await cartBody(client, cartId, session);
  });
  res.status(200).json(result);
}));
