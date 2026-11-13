import type { Client } from '../db/pool.js';
import { Router } from 'express';
import { h } from './h.js';
import { withClient, inTransaction } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors } from '../domain/errors.js';
import { readSession, requireSignedIn, type SessionInfo } from './session.js';
import { publish } from '../domain/events.js';
import { moveStock, availableFor, type Location } from '../domain/ledger.js';
import { computeTotals, type CartLineInput, type AppliedCode } from '../domain/totals.js';
import { ensureCart, loadCartRow } from './cart.js';
import { validateAddress, canonicalToken } from './account.js';

export const checkoutRouter = Router();

const STEPS = ['contact', 'delivery', 'shipping', 'payment'] as const;
type Step = (typeof STEPS)[number];

export type CheckoutRow = {
  id: string; session_token: string; user_id: string; step: Step; email: string | null; phone: string | null;
  address_id: string | null; address: Record<string, unknown> | null; shipping_method: 'standard' | 'express';
  gift: boolean; gift_message: string | null; lines: CheckoutLine[]; totals: Record<string, number>;
  discount_code: string | null; gift_card_code: string | null;
};

export type CheckoutLine = { sku: string; quantity: number };

checkoutRouter.post('/checkout', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const created = await inTransaction(async (client) => {
    const cartId = await ensureCart(client, session);
    const cart = await loadCartRow(client, await canonicalToken(client, session));
    const lines = await client.query<CheckoutLine>(
      `SELECT sku, quantity FROM cart_lines WHERE cart_id = $1 ORDER BY id`, [cartId]);
    if (lines.rows.length === 0) throw Errors.validationFailed({ cart: 'Your bag is empty.' });
    const insert = await client.query<{ id: string }>(
      `INSERT INTO checkouts (session_token, user_id, step, lines, totals, discount_code, gift_card_code, shipping_method)
       VALUES ($1,$2,'contact',$3,$4,$5,$6,$7) RETURNING id::TEXT AS id`,
      [session.token, userId, JSON.stringify(lines.rows), JSON.stringify({}), cart?.discount_code ?? null, cart?.gift_card_code ?? null, cart?.shipping_method ?? 'standard']);
    return Number(insert.rows[0].id);
  });
  res.status(201).json(await checkoutBody(created, session));
}));

export async function checkoutBody(checkoutId: number, session: SessionInfo): Promise<Record<string, unknown>> {
  return inTransaction(async (client) => {
    const row = await loadCheckout(client, checkoutId);
    if (row === null) throw Errors.notFound();
    if (row.session_token !== session.token && row.user_id !== String(session.userId)) throw Errors.notFound();
    await releaseLapsedHolds(client, [checkoutId]);
    const hold = await activeHold(client, checkoutId);
    const totals = await checkoutTotals(client, row);
    return {
      id: checkoutId,
      step: row.step,
      contact: { email: row.email, phone: row.phone },
      delivery: { address: row.address },
      shipping_method: row.shipping_method,
      gift: row.gift,
      gift_message: row.gift_message,
      lines: await checkoutLines(client, row),
      totals,
      hold: hold === null
        ? { status: 'none', expires_at: null, seconds_left: null }
        : { status: hold.status === 'active' ? 'active' : 'expired', expires_at: hold.expires_at.toISOString(), seconds_left: Math.max(0, Math.floor((hold.expires_at.getTime() - Date.now()) / 1000)) },
      server_time: new Date().toISOString(),
    };
  });
}

async function checkoutLines(client: Client, row: CheckoutRow): Promise<Record<string, unknown>[]> {
  const lines = row.lines;
  const skus = lines.map((l) => l.sku);
  const variants = await client.query<{ sku: string; product: string; colour: string; size: string; price: number }>(
    `SELECT v.sku, p.name AS product, v.colour, v.size, v.price FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = ANY($1)`, [skus]);
  const bySku = new Map<string, { sku: string; product: string; colour: string; size: string; price: number }>(variants.rows.map((v) => [v.sku, v]));
  const availability = await availableFor(client, skus);
  return lines.map((l) => {
    const v = bySku.get(l.sku)!;
    return {
      id: l.sku, sku: l.sku, product: v.product, colour: v.colour, size: v.size,
      quantity: l.quantity, unit_price: v.price, line_subtotal: v.price * l.quantity, line_discount: 0,
      available: availability.get(l.sku) ?? 0, badge: (availability.get(l.sku) ?? 0) <= 0 ? 'Out of stock' : 'In stock',
    };
  });
}

export async function loadCheckout(client: Client, id: number): Promise<CheckoutRow | null> {
  const res = await client.query<CheckoutRow>(
    `SELECT id::TEXT AS id, session_token, user_id::TEXT AS user_id, step, email, phone, address_id::TEXT AS address_id,
            address, shipping_method, gift, gift_message, lines, totals, discount_code, gift_card_code
     FROM checkouts WHERE id = $1`, [id]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { ...row, address: row.address as Record<string, unknown> | null, lines: row.lines as CheckoutLine[], totals: row.totals as Record<string, number> };
}

export async function checkoutTotals(client: Client, row: CheckoutRow): Promise<Record<string, number>> {
  const variants = await client.query<{ sku: string; price: number; collection: string }>(
    `SELECT v.sku, v.price, p.category AS collection FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = ANY($1)`,
    [row.lines.map((l) => l.sku)]);
  const bySku = new Map<string, { sku: string; price: number; collection: string }>(variants.rows.map((v) => [v.sku, v]));
  const inputs: CartLineInput[] = row.lines.map((l) => ({
    sku: l.sku, product: '', collection: bySku.get(l.sku)?.collection ?? '',
    unit_price: bySku.get(l.sku)?.price ?? 0, quantity: l.quantity,
  }));
  const code = row.discount_code === null ? null : await loadCodeRow(client, row.discount_code);
  const giftBalance = row.gift_card_code === null ? null : await giftBalanceOf(client, row.gift_card_code);
  const { totals } = computeTotals(inputs, code, row.shipping_method, giftBalance);
  return {
    subtotal: totals.subtotal, discount: totals.discount, shipping: totals.shipping,
    tax: totals.tax, gift_card: totals.gift_card, total: totals.total,
  };
}

async function loadCodeRow(client: Client, code: string): Promise<AppliedCode> {
  const res = await client.query<{ code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number; starts_at: Date; ends_at: Date; usage_limit: number | null; used: number }>(
    `SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes WHERE UPPER(code) = UPPER($1)`, [code]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const now = new Date();
  if (now < row.starts_at || now >= row.ends_at) return null;
  if (row.usage_limit !== null && row.used >= row.usage_limit) return null;
  return { code: row.code, kind: row.kind, value: row.value, collection: row.collection, minimum: row.minimum };
}

async function giftBalanceOf(client: Client, code: string): Promise<number | null> {
  const card = await client.query(`SELECT code FROM gift_cards WHERE code = $1`, [code]);
  if (card.rows.length === 0) return null;
  const res = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0)::TEXT AS balance FROM gift_card_ledger WHERE code = $1`, [code]);
  return Number(res.rows[0].balance);
}

export async function activeHold(client: Client, checkoutId: number): Promise<{ id: number; status: string; reserved_at: Date; expires_at: Date } | null> {
  const res = await client.query<{ id: string; status: string; reserved_at: Date; expires_at: Date }>(
    `SELECT id::TEXT AS id, status, reserved_at, expires_at FROM holds WHERE checkout_id = $1 ORDER BY id DESC LIMIT 1`, [checkoutId]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { id: Number(row.id), status: row.status, reserved_at: row.reserved_at, expires_at: row.expires_at };
}

/** Lapsed holds are released on every read, reserve and by the sweep. */
export async function releaseLapsedHolds(client: Client, checkoutIds: number[]): Promise<void> {
  if (checkoutIds.length === 0) return;
  const expired = await client.query<{ id: string }>(
    `SELECT id::TEXT AS id FROM holds WHERE checkout_id = ANY($1) AND status = 'active' AND expires_at <= now()`, [checkoutIds]);
  for (const row of expired.rows) {
    await releaseHold(client, Number(row.id));
  }
}

export async function releaseHold(client: Client, holdId: number, reason: 'hold_released' | 'hold_lapsed' = 'hold_lapsed'): Promise<void> {
  const lines = await client.query<{ sku: string; location: Location; quantity: number }>(
    `SELECT sku, location, quantity FROM hold_lines WHERE hold_id = $1`, [holdId]);
  if (lines.rows.length === 0) return;
  await moveStock(client, reason, `hold/${holdId}`, lines.rows.map((l) => ({ sku: l.sku, location: l.location, quantity: l.quantity })));
  await client.query(`UPDATE holds SET status = 'released', released_at = now() WHERE id = $1 AND status = 'active'`, [holdId]);
}

checkoutRouter.get('/checkout/:id', h(async (req, res) => {
  const session = await readSession(req, res);
  requireSignedIn(session);
  res.status(200).json(await checkoutBody(Number(req.params.id), session));
}));

checkoutRouter.patch('/checkout/:id', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const checkoutId = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const step = String(body.step ?? '');
  const go = body.go === true;

  const result = await inTransaction(async (client) => {
    const row = await loadCheckout(client, checkoutId);
    if (row === null || row.user_id !== String(userId)) throw Errors.notFound();

    const fields: Record<string, string> = {};
    if (go) {
      const target = STEPS.indexOf(step as Step);
      const current = STEPS.indexOf(row.step);
      if (target >= 0 && target < current) {
        await client.query(`UPDATE checkouts SET step = $1, updated_at = now() WHERE id = $2`, [step, checkoutId]);
        return { step };
      }
      throw Errors.notFound();
    }

    if (step === 'contact') {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter an email address like name@example.com.';
      if (!/^[1-9][0-9]{9}$/.test(phone)) fields.phone = 'Enter a 10-digit mobile number.';
      if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);
      await client.query(`UPDATE checkouts SET email = $1, phone = $2, step = 'delivery', updated_at = now() WHERE id = $3`, [email, phone, checkoutId]);
      return { step: 'delivery' };
    }

    if (step === 'delivery') {
      if (body.address_id !== undefined) {
        const addressId = Number(body.address_id);
        const address = await client.query(`SELECT id FROM addresses WHERE id = $1 AND user_id = $2`, [addressId, userId]);
        if (address.rows.length === 0) throw Errors.notFound();
        const full = await client.query(`SELECT label, name, line1, line2, city, state, postcode, phone FROM addresses WHERE id = $1`, [addressId]);
        await client.query(`UPDATE checkouts SET address_id = $1, address = $2, step = 'shipping', updated_at = now() WHERE id = $3`,
          [addressId, JSON.stringify(full.rows[0]), checkoutId]);
        return { step: 'shipping' };
      }
      const address = (body.address ?? {}) as Record<string, unknown>;
      const addressFields = validateAddress(address);
      if (addressFields) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(addressFields)) mapped[`address.${k}`] = v;
        throw Errors.validationFailed(mapped);
      }
      await client.query(`UPDATE checkouts SET address = $1, step = 'shipping', updated_at = now() WHERE id = $2`,
        [JSON.stringify(address), checkoutId]);
      return { step: 'shipping' };
    }

    if (step === 'shipping') {
      const method = body.method === 'express' ? 'express' : body.method === 'standard' ? 'standard' : '';
      if (method === '') fields.method = 'Choose a shipping method.';
      const gift = body.gift === true;
      const giftMessage = typeof body.gift_message === 'string' ? body.gift_message : '';
      if (giftMessage.length > 200) fields.gift_message = 'Keep the gift message to 200 characters or fewer.';
      if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);
      await client.query(
        `UPDATE checkouts SET shipping_method = $1, gift = $2, gift_message = $3, step = 'payment', updated_at = now() WHERE id = $4`,
        [method, gift, giftMessage === '' ? null : giftMessage, checkoutId]);
      await client.query(`UPDATE carts SET shipping_method = $1 WHERE session_token = $2`, [method, session.token]);
      return { step: 'payment' };
    }

    throw Errors.notFound();
  });
  res.status(200).json(await checkoutBody(checkoutId, session));
}));

// --- reserve (holds) ---------------------------------------------------------

checkoutRouter.post('/checkout/:id/reserve', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const checkoutId = Number(req.params.id);
  const result = await holdCheckout(checkoutId, userId, session);
  res.status(200).json({ hold: result.hold });
}));

export async function holdCheckout(checkoutId: number, userId: number, session: SessionInfo): Promise<{ hold: Record<string, unknown> }> {
  return inTransaction(async (client) => {
    const row = await loadCheckout(client, checkoutId);
    if (row === null || row.user_id !== String(userId)) throw Errors.notFound();
    await releaseLapsedHolds(client, [checkoutId]);
    const existing = await activeHold(client, checkoutId);
    if (existing !== null && existing.status === 'active') {
      return { hold: holdBody(existing) };
    }
    const skus = row.lines.map((l) => l.sku).sort();
    await client.query(`SELECT sku FROM variants WHERE sku = ANY($1) ORDER BY sku FOR UPDATE`, [skus]);
    const availability = await availableFor(client, skus);
    const perLocation = await client.query<{ sku: string; location: Location; available: string }>(
      `SELECT sku, location, COALESCE(SUM(quantity),0)::TEXT AS available FROM stock_entries
       WHERE sku = ANY($1) AND account = 'available' GROUP BY sku, location`, [skus]);
    const bySku = new Map<string, { location: Location; available: number }[]>();
    for (const r of perLocation.rows) {
      const list = bySku.get(r.sku) ?? [];
      list.push({ location: r.location, available: Number(r.available) });
      bySku.set(r.sku, list);
    }
    const entries: { sku: string; location: Location; quantity: number }[] = [];
    for (const line of row.lines) {
      const have = availability.get(line.sku) ?? 0;
      if (have < line.quantity) {
        const info = await client.query<{ name: string; colour: string; size: string }>(
          `SELECT p.name, v.colour, v.size FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [line.sku]);
        const v = info.rows[0];
        if (have <= 0) throw Errors.outOfStockGone(`${v.name} — ${v.colour}, ${v.size}`);
        throw Errors.outOfStockSome(have);
      }
    }
    for (const line of row.lines) {
      const options = bySku.get(line.sku) ?? [];
      const plan = planHold(options, line.quantity);
      for (const p of plan) entries.push({ sku: line.sku, location: p.location, quantity: p.take });
    }
    const reservedAt = new Date();
    const expiresAt = new Date(reservedAt.getTime() + CONFIG.reservationTtlSeconds * 1000);
    const hold = await client.query<{ id: string }>(
      `INSERT INTO holds (checkout_id, status, reserved_at, expires_at) VALUES ($1,'active',$2,$3) RETURNING id::TEXT AS id`,
      [checkoutId, reservedAt, expiresAt]);
    for (const entry of entries) {
      await client.query(`INSERT INTO hold_lines (hold_id, sku, location, quantity) VALUES ($1,$2,$3,$4)`,
        [Number(hold.rows[0].id), entry.sku, entry.location, entry.quantity]);
    }
    await moveStock(client, 'hold_placed', `hold/${hold.rows[0].id}`, entries);
    for (const entry of entries) {
      await publishStock(client, entry.sku);
    }
    return { hold: holdBody({ id: Number(hold.rows[0].id), status: 'active', reserved_at: reservedAt, expires_at: expiresAt }) };
  });
}

export function planHold(options: { location: Location; available: number }[], quantity: number): { location: Location; take: number }[] {
  const ordered = [...options].sort((a, b) => (b.available - a.available) || (a.location === 'bhiwandi' ? -1 : 1));
  const plan: { location: Location; take: number }[] = [];
  let remaining = quantity;
  for (const option of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(option.available, remaining);
    if (take > 0) {
      plan.push({ location: option.location, take });
      remaining -= take;
    }
  }
  return plan;
}

/** A price change is announced live to every open session. */
export async function publishPrice(client: Client, sku: string): Promise<void> {
  const res = await client.query<{ price: number; compare_at: number | null }>(
    `SELECT price, compare_at FROM variants WHERE sku = $1`, [sku]);
  const row = res.rows[0];
  if (row === undefined) return;
  await publish(client, 'price', { sku, price: row.price, compare_at: row.compare_at },
    { userId: null, sessionId: null, staffVisible: false });
}

export async function publishStock(client: Client, sku: string): Promise<void> {
  const available = (await availableFor(client, [sku])).get(sku) ?? 0;
  const badge = available <= 0 ? 'Out of stock' : available <= CONFIG.lowStockThreshold ? `Only ${available} left` : 'In stock';
  await publish(client, 'stock', { sku, available, badge }, { userId: null, sessionId: null, staffVisible: false });
}

function holdBody(hold: { id: number; status: string; reserved_at: Date; expires_at: Date }): Record<string, unknown> {
  return {
    status: 'active',
    expires_at: hold.expires_at.toISOString(),
    seconds_left: Math.max(0, Math.floor((hold.expires_at.getTime() - Date.now()) / 1000)),
  };
}
