import type { Client } from '../db/pool.js';
import { Router } from 'express';
import { h } from './h.js';
import { pool, withClient, inTransaction } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors, dateText, rupeeText, digitGroup } from '../domain/errors.js';
import { readSession, requireSignedIn, type SessionInfo } from './session.js';
import { publish } from '../domain/events.js';
import { moveStock, availableFor, type Location } from '../domain/ledger.js';
import { computeTotals, type AppliedCode } from '../domain/totals.js';
import { sendEmail } from '../services/mail.js';
import { sha256Hex } from '../domain/password.js';
import { holdCheckout, loadCheckout, activeHold, releaseLapsedHolds, releaseHold, checkoutTotals, publishStock, type CheckoutRow, type CheckoutLine } from './checkout.js';
import { ensureCart } from './cart.js';

export const orderRouter = Router();

const ORDER_TRANSITIONS: Record<string, string[]> = {
  placed: ['packed', 'cancelled'],
  packed: ['partially_shipped', 'shipped', 'cancelled'],
  partially_shipped: ['shipped'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function orderCanMove(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

// --- placement ---------------------------------------------------------------

orderRouter.post('/orders', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const idemKey = req.header('idempotency-key') ?? '';
  if (idemKey.length < 8 || idemKey.length > 128) {
    throw Errors.validationFailed({ 'Idempotency-Key': 'Send an Idempotency-Key of 8 to 128 characters.' });
  }
  const body = req.body as { checkout_id?: unknown; card?: { number?: unknown; expiry?: unknown; cvc?: unknown } };
  const checkoutId = Number(body.checkout_id);
  const stored = await pool.query<{ status: number; response: string; body_hash: string }>(
    `SELECT status, response, body_hash FROM idempotency_keys WHERE key = $1 AND user_id = $2 AND route = 'POST /api/orders'`,
    [idemKey, userId]);
  const bodyHash = sha256Hex(JSON.stringify(body));
  if (stored.rows.length > 0) {
    if (stored.rows[0].body_hash !== bodyHash) throw Errors.idempotencyMismatch();
    res.setHeader('Idempotency-Replayed', 'true');
    res.status(stored.rows[0].status).json(JSON.parse(stored.rows[0].response));
    return;
  }

  const placed = await placeOrder(checkoutId, userId, session, cardInputFrom(body.card));
  await pool.query(
    `INSERT INTO idempotency_keys (key, user_id, route, body_hash, status, response) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (key, user_id, route) DO NOTHING`,
    [idemKey, userId, 'POST /api/orders', bodyHash, 201, JSON.stringify(placed.order)]);
  res.status(201).json(placed.order);
}));

export type CardInput = { number: string; expiry: string; cvc: string } | null;

/** Placement is all or nothing: stock commit, payment, gift card, code use, email. */
export async function placeOrder(checkoutId: number, userId: number, session: SessionInfo, card: CardInput): Promise<{ order: Record<string, unknown> }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await loadCheckout(client, checkoutId);
    if (row === null || row.user_id !== String(userId)) throw Errors.notFound();
    if (row.step !== 'payment') throw Errors.notFound();

    await releaseLapsedHolds(client, [checkoutId]);
    let hold = await activeHold(client, checkoutId);
    if (hold === null || hold.status !== 'active') {
      await client.query('COMMIT');
      await holdCheckout(checkoutId, userId, session);
      return placeOrderRetryAfterHold(checkoutId, userId, session, card);
    }

    const totals = await checkoutTotals(client, row);
    const cardAmount = totals.total;
    const giftCardAmount = totals.gift_card;
    if (cardAmount > 0) {
      if (card === null) throw Errors.validationFailed({ 'card.number': 'Enter a 16-digit card number.', 'card.expiry': 'Enter an expiry date in the future, as MM/YY.', 'card.cvc': 'Enter the 3-digit security code.' });
      const fields = validateCard(card);
      if (fields) throw Errors.validationFailed(fields);
      const outcome = simulateCard(card.number);
      if (outcome !== 'authorized') {
        await client.query(`INSERT INTO payment_attempts (checkout_id, status) VALUES ($1,'failed')`, [checkoutId]);
        await client.query('COMMIT');
        throw outcome === 'declined' ? Errors.cardDeclined() : Errors.insufficientFunds();
      }
    }

    // Gift card spend, checked and spent in one step.
    if (giftCardAmount > 0 && row.gift_card_code !== null) {
      const balanceRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(amount),0)::TEXT AS balance FROM gift_card_ledger WHERE code = $1 FOR UPDATE`, [row.gift_card_code]);
      const balance = Number(balanceRes.rows[0].balance);
      if (balance < giftCardAmount) {
        await client.query('COMMIT');
        throw Errors.alreadyRedeemed(balance);
      }
    }

    const number = await nextOrderNumber(client);
    const lines = row.lines;
    const skus = lines.map((l) => l.sku).sort();
    await client.query(`SELECT sku FROM variants WHERE sku = ANY($1) ORDER BY sku FOR UPDATE`, [skus]);

    // 1. commit every held line
    const holdLines = await client.query<{ sku: string; location: Location; quantity: number }>(
      `SELECT sku, location, quantity FROM hold_lines WHERE hold_id = $1`, [hold.id]);
    await moveStock(client, 'order_committed', `order/${number}`, holdLines.rows);
    await client.query(`UPDATE holds SET status = 'committed' WHERE id = $1`, [hold.id]);

    // 5. create the order with line-level figures
    const variantRows = await client.query<{ sku: string; product: string; colour: string; size: string; price: number; collection: string }>(
      `SELECT v.sku, p.name AS product, v.colour, v.size, v.price, p.category AS collection FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = ANY($1)`,
      [lines.map((l) => l.sku)]);
    const bySku = new Map<string, { sku: string; product: string; colour: string; size: string; price: number; collection: string }>(variantRows.rows.map((v) => [v.sku, v]));
    const appliedCode = row.discount_code === null ? null : await loadAppliedCode(client, row.discount_code);
    const lineFigures = computeLineFigures(row, bySku, appliedCode);
    const tax = lineFigures.reduce((sum, l) => sum + l.line_tax, 0) + totalsShippingTax(row, lineFigures);
    const subtotal = lineFigures.reduce((sum, l) => sum + l.line_subtotal, 0);
    const discount = lineFigures.reduce((sum, l) => sum + l.line_discount, 0);
    const shipping = shippingFor(row, subtotal - discount);
    const shippingTax = shipping === 0 ? 0 : roundHalfUp((shipping * CONFIG.taxRatePercent) / 100);
    const grandTotal = subtotal - discount + shipping + tax;
    const address = row.address ?? {};
    const user = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
    await client.query(
      `INSERT INTO orders (number, user_id, status, kind, email, phone, address, shipping_method, gift, gift_message,
        subtotal, discount, shipping, shipping_tax, tax, gift_card_amount, total, discount_code, gift_card_code, placed_at, confirmation_emailed_at)
       VALUES ($1,$2,'placed','order',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),NULL)`,
      [number, userId, row.email ?? user.rows[0].email, row.phone, JSON.stringify(address), row.shipping_method,
        row.gift, row.gift_message, subtotal, discount, shipping, shippingTax, tax, giftCardAmount, cardAmount,
        row.discount_code, row.gift_card_code]);
    for (const line of lineFigures) {
      await client.query(
        `INSERT INTO order_lines (order_id, sku, product, colour, size, quantity, unit_price, line_subtotal, line_discount, line_tax, fulfillment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unfulfilled')`,
        [number, line.sku, line.product, line.colour, line.size, line.quantity, line.unit_price, line.line_subtotal, line.line_discount, line.line_tax]);
    }
    await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,'placed',now())`, [number]);

    // 2. payment record
    await client.query(
      `INSERT INTO payments (order_number, status, amount, card_amount, gift_card_amount, card_last4)
       VALUES ($1,'captured',$2,$3,$4,$5)`,
      [number, cardAmount + giftCardAmount, cardAmount, giftCardAmount, card === null ? null : card.number.replace(/\s/g, '').slice(-4)]);

    // 3. spend the gift card
    if (giftCardAmount > 0 && row.gift_card_code !== null) {
      const group = await client.query<{ id: string }>(
        `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'order',$2,'spend',$3) RETURNING id::TEXT AS id`,
        [row.gift_card_code, -giftCardAmount, `order/${number}`]);
      await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(group.rows[0].id)]);
      const group2 = await client.query<{ id: string }>(
        `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'card',$2,'spend',$3) RETURNING id::TEXT AS id`,
        [row.gift_card_code, giftCardAmount, `order/${number}`]);
      await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(group2.rows[0].id)]);
    }

    // 4. count the discount use
    if (row.discount_code !== null) {
      await client.query(`UPDATE discount_codes SET used = used + 1 WHERE code = $1`, [row.discount_code]);
      await client.query(`INSERT INTO discount_code_uses (code, order_number) VALUES ($1,$2)`, [row.discount_code, number]);
    }



    // 6. hand the confirmation email to the mail server; the order commits only after it accepts
    const subject = `Your Roam House order ${number} is placed`;
    const sent = await sendEmail(row.email ?? user.rows[0].email, subject, `Order ${number} is placed.\nTotal ₹${digitGroup(cardAmount + giftCardAmount)}.\n\nRoam House\n`);
    if (!sent) {
      await client.query('ROLLBACK');
      throw Errors.emailUnavailable();
    }
    const notif = await client.query<{ id: string }>(
      `INSERT INTO notifications (user_id, text, email_status, emailed_at) VALUES ($1,$2,'emailed',now()) RETURNING id::TEXT AS id`,
      [userId, subject]);
    await publish(client, 'notification', { text: subject, email_status: 'emailed' }, { userId, sessionId: null, staffVisible: true });
    await client.query(`UPDATE orders SET confirmation_emailed_at = now() WHERE number = $1`, [number]);

    await publish(client, 'order', {
      number, status: 'placed', payment_status: 'captured', version: 1,
      lines: (await client.query(`SELECT id::TEXT AS id, fulfillment, carrier, tracking_number FROM order_lines WHERE order_id = $1`, [number])).rows.map((l) => ({
        id: Number(l.id), fulfillment: l.fulfillment, shipment: l.carrier === null ? null : { carrier: l.carrier, tracking_number: l.tracking_number },
      })),
    }, { userId, sessionId: null, staffVisible: true });

    // Empty the bag for the next order.
    const cartId = await ensureCart(client, session);
    await client.query(`DELETE FROM cart_lines WHERE cart_id = $1`, [cartId]);
    await client.query(`UPDATE carts SET discount_code = NULL, gift_card_code = NULL, shipping_method = 'standard' WHERE id = $1`, [cartId]);
    await publish(client, 'cart', { count: 0 }, { userId, sessionId: session.token, staffVisible: false });

    await client.query('COMMIT');
    const order = await orderBodyByNumber(number, userId, client);
    return { order };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* not in a transaction */ }
    throw err;
  } finally {
    client.release();
  }
}

function cardInputFrom(card: { number?: unknown; expiry?: unknown; cvc?: unknown } | undefined | null): CardInput {
  if (card === null || card === undefined) return null;
  const number = typeof card.number === 'string' ? card.number : '';
  const expiry = typeof card.expiry === 'string' ? card.expiry : '';
  const cvc = typeof card.cvc === 'string' ? card.cvc : '';
  return { number, expiry, cvc };
}

async function placeOrderRetryAfterHold(checkoutId: number, userId: number, session: SessionInfo, card: CardInput): Promise<{ order: Record<string, unknown> }> {
  return placeOrder(checkoutId, userId, session, card);
}

function validateCard(card: { number?: unknown; expiry?: unknown; cvc?: unknown }): Record<string, string> | null {
  const fields: Record<string, string> = {};
  const number = typeof card.number === 'string' ? card.number.replace(/\s/g, '') : '';
  if (!/^[0-9]{16}$/.test(number)) fields['card.number'] = 'Enter a 16-digit card number.';
  const expiry = typeof card.expiry === 'string' ? card.expiry.trim() : '';
  const match = /^([0-9]{2})\/([0-9]{2})$/.exec(expiry);
  if (match === null) {
    fields['card.expiry'] = 'Enter an expiry date in the future, as MM/YY.';
  } else {
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    const now = new Date();
    const expiryDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    if (month < 1 || month > 12 || expiryDate < now) fields['card.expiry'] = 'Enter an expiry date in the future, as MM/YY.';
  }
  const cvc = typeof card.cvc === 'string' ? card.cvc.trim() : '';
  if (!/^[0-9]{3}$/.test(cvc)) fields['card.cvc'] = 'Enter the 3-digit security code.';
  return Object.keys(fields).length > 0 ? fields : null;
}

export function simulateCard(number: string): 'authorized' | 'declined' | 'insufficient' {
  const digits = number.replace(/\s/g, '');
  if (digits === '4000000000000002') return 'declined';
  if (digits === '4000000000009995') return 'insufficient';
  return 'authorized';
}

async function loadAppliedCode(client: Client, code: string): Promise<AppliedCode> {
  const res = await client.query<{ code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number; starts_at: Date; ends_at: Date; usage_limit: number | null; used: number }>(
    `SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes WHERE code = $1`, [code]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const now = new Date();
  if (now < row.starts_at || now >= row.ends_at) return null;
  if (row.usage_limit !== null && row.used >= row.usage_limit) return null;
  return { code: row.code, kind: row.kind, value: row.value, collection: row.collection, minimum: row.minimum };
}

function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

type LineFigure = { sku: string; product: string; colour: string; size: string; quantity: number; unit_price: number; line_subtotal: number; line_discount: number; line_tax: number };

function computeLineFigures(row: CheckoutRow, bySku: Map<string, { product: string; colour: string; size: string; price: number; collection: string }>, code: AppliedCode): LineFigure[] {
  const inputs = row.lines.map((l) => {
    const v = bySku.get(l.sku)!;
    return { sku: l.sku, product: v.product, collection: v.collection, unit_price: v.price, quantity: l.quantity };
  });
  const { lines } = computeTotals(inputs, code, row.shipping_method, null);
  return row.lines.map((l, i) => {
    const v = bySku.get(l.sku)!;
    return {
      sku: l.sku, product: v.product, colour: v.colour, size: v.size, quantity: l.quantity,
      unit_price: v.price, line_subtotal: lines[i].line_subtotal, line_discount: lines[i].line_discount, line_tax: lines[i].line_tax,
    };
  });
}

function totalsShippingTax(row: CheckoutRow, figures: LineFigure[]): number {
  const discounted = figures.reduce((sum, l) => sum + l.line_subtotal - l.line_discount, 0);
  const shipping = shippingFor(row, discounted);
  return shipping === 0 ? 0 : roundHalfUp((shipping * CONFIG.taxRatePercent) / 100);
}

function shippingFor(row: CheckoutRow, discountedSubtotal: number): number {
  if (row.shipping_method === 'express') return 499;
  return discountedSubtotal >= CONFIG.freeShippingMinimum ? 0 : (discountedSubtotal === 0 ? 0 : 249);
}

async function nextOrderNumber(client: Client): Promise<string> {
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(SUBSTRING(number FROM 4)::INT), 100000) + 1 AS n FROM orders WHERE number LIKE 'RH-%'`);
  return `RH-${res.rows[0].n}`;
}

// --- reading ----------------------------------------------------------------

orderRouter.get('/orders', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const rows = await pool.query<{ number: string; status: string; placed_at: Date; total: number }>(
    `SELECT o.number, o.status, o.placed_at, o.total FROM orders o WHERE o.user_id = $1 ORDER BY o.placed_at DESC, o.number DESC`, [userId]);
  res.status(200).json(rows.rows.map((r) => ({
    number: r.number, status: r.status, placed_at: r.placed_at.toISOString(), total: r.total,
  })));
}));

orderRouter.get('/orders/:number', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  res.status(200).json(await orderBodyByNumber(req.params.number, userId));
}));

export async function orderBodyByNumber(number: string, userId: number, existingClient?: Client): Promise<Record<string, unknown>> {
  const build = async (client: Client): Promise<Record<string, unknown>> => {
    const order = await client.query<{
      number: string; user_id: string; version: number; status: string; kind: string; email: string; phone: string | null;
      address: Record<string, unknown>; shipping_method: string; gift: boolean; gift_message: string | null;
      subtotal: number; discount: number; shipping: number; shipping_tax: number; tax: number; gift_card_amount: number; total: number;
      discount_code: string | null; gift_card_code: string | null; placed_at: Date; delivered_at: Date | null;
      confirmation_emailed_at: Date | null;
    }>(
      `SELECT number, user_id::TEXT AS user_id, version, status, kind, email, phone, address, shipping_method, gift, gift_message,
              subtotal, discount, shipping, shipping_tax, tax, gift_card_amount, total, discount_code, gift_card_code,
              placed_at, delivered_at, confirmation_emailed_at
       FROM orders WHERE number = $1`, [number]);
    if (order.rows.length === 0 || Number(order.rows[0].user_id) !== userId) throw Errors.notFound();
    const o = order.rows[0];
    const payment = await client.query<{ status: string; amount: number; card_amount: number; gift_card_amount: number; card_last4: string | null; refunded: number }>(
      `SELECT status, amount, card_amount, gift_card_amount, card_last4, refunded FROM payments WHERE order_number = $1`, [number]);
    const lines = await client.query<{
      id: string; sku: string; product: string; colour: string; size: string; quantity: number;
      unit_price: number; line_subtotal: number; line_discount: number; line_tax: number;
      fulfillment: string; carrier: string | null; tracking_number: string | null;
    }>(
      `SELECT id::TEXT AS id, sku, product, colour, size, quantity, unit_price, line_subtotal, line_discount, line_tax, fulfillment, carrier, tracking_number
       FROM order_lines WHERE order_id = $1 ORDER BY id`, [number]);
    const timeline = await client.query<{ status: string; at: Date }>(
      `SELECT status, at FROM order_timeline WHERE order_number = $1 ORDER BY at, id`, [number]);
    const registration = await client.query<{ id: string; covered_until: Date }>(
      `SELECT id::TEXT AS id, covered_until FROM warranty_registrations WHERE order_line_id = $1`, [Number(lines.rows[0]?.id ?? 0)]);

    const now = new Date();
    const returnWindow = windowBody(o.delivered_at, CONFIG.returnWindowDays, now);
    const trialWindow = windowBody(o.delivered_at, CONFIG.trialWindowDays, now);

    const lineBodies = [];
    for (const line of lines.rows) {
      const reg = await client.query<{ id: string; covered_until: Date }>(
        `SELECT id::TEXT AS id, covered_until FROM warranty_registrations WHERE order_line_id = $1`, [Number(line.id)]);
      const lineCategory = await client.query<{ category: string }>(
        `SELECT p.category FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [line.sku]);
      const trialCapped = ['luggage','backpacks','totes'].includes(lineCategory.rows[0]?.category ?? '');
      const productSlugRow = await client.query<{ product_slug: string }>(
        `SELECT product_slug FROM variants WHERE sku = $1`, [line.sku]);
      lineBodies.push({
        id: Number(line.id),
        sku: line.sku,
        product_slug: productSlugRow.rows[0]?.product_slug ?? '',
        product: line.product,
        colour: line.colour,
        size: line.size,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_subtotal: line.line_subtotal,
        line_discount: line.line_discount,
        line_tax: line.line_tax,
        fulfillment: line.fulfillment,
        shipment: line.carrier === null ? null : { carrier: line.carrier, tracking_number: line.tracking_number },
        return_eligible: o.delivered_at !== null && now < new Date(o.delivered_at.getTime() + CONFIG.returnWindowDays * 86400000),
        trial_eligible: o.delivered_at !== null && trialCapped && now < new Date(o.delivered_at.getTime() + CONFIG.trialWindowDays * 86400000),
        warranty: reg.rows.length === 0 ? null : { registration_id: Number(reg.rows[0].id), covered_until: reg.rows[0].covered_until.toISOString() },
      });
    }

    return {
      number: o.number,
      status: o.status,
      version: o.version,
      placed_at: o.placed_at.toISOString(),
      delivered_at: o.delivered_at === null ? null : o.delivered_at.toISOString(),
      confirmation_emailed_at: o.confirmation_emailed_at === null ? null : o.confirmation_emailed_at.toISOString(),
      payment: {
        status: payment.rows[0].status, amount: payment.rows[0].amount,
        card_amount: payment.rows[0].card_amount, gift_card_amount: payment.rows[0].gift_card_amount,
        card_last4: payment.rows[0].card_last4, refunded: payment.rows[0].refunded,
      },
      email: o.email,
      phone: o.phone,
      address: o.address,
      shipping_method: o.shipping_method,
      gift: o.gift,
      gift_message: o.gift_message,
      lines: lineBodies,
      totals: {
        subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, tax: o.tax + o.shipping_tax,
        gift_card: o.gift_card_amount, total: o.total,
      },
      shipping_tax: o.shipping_tax,
      discount_code: o.discount_code,
      gift_card_code: o.gift_card_code,
      timeline: timeline.rows.map((t) => ({ status: t.status, label: TIMELINE_LABELS[t.status], at: t.at.toISOString() })),
      return_window: returnWindow,
      trial_window: trialWindow,
      server_time: now.toISOString(),
    };
  };
  if (existingClient !== undefined) return build(existingClient);
  return withClient(build);
}

const TIMELINE_LABELS: Record<string, string> = {
  placed: 'Order placed', packed: 'Packed', partially_shipped: 'Partially shipped', shipped: 'Shipped',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
};

function windowBody(deliveredAt: Date | null, days: number, now: Date): { ends_at: string | null; seconds_left: number | null; open: boolean } {
  if (deliveredAt === null) return { ends_at: null, seconds_left: null, open: false };
  const ends = new Date(deliveredAt.getTime() + days * 86400000);
  return { ends_at: ends.toISOString(), seconds_left: Math.max(0, Math.floor((ends.getTime() - now.getTime()) / 1000)), open: now < ends };
}

// --- cancellation ------------------------------------------------------------

orderRouter.post('/orders/:number/cancel', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const number = req.params.number;
  const order = await cancelOrder(number, userId, session, null);
  res.status(200).json(order);
}));

export async function cancelOrder(number: string, userId: number | null, session: SessionInfo | null, actor: { id: number; name: string; role: string } | null): Promise<Record<string, unknown>> {
  return inTransaction(async (client) => {
    const order = await client.query<{ user_id: string; status: string; version: number; email: string }>(
      `SELECT user_id::TEXT AS user_id, status, version, email FROM orders WHERE number = $1 FOR UPDATE`, [number]);
    if (order.rows.length === 0) throw Errors.notFound();
    if (userId !== null && Number(order.rows[0].user_id) !== userId) throw Errors.notFound();
    if (!orderCanMove(order.rows[0].status, 'cancelled')) throw Errors.invalidTransition();

    // Committed stock returns to available, one movement per cancelled order.
    const cancelEntries = await client.query<{ sku: string; location: Location; quantity: number }>(`
      SELECT l.sku, h.location, l.quantity
      FROM order_lines l
      JOIN hold_lines h ON h.sku = l.sku
      JOIN holds ho ON ho.id = h.hold_id
      WHERE l.order_id = $1 AND l.fulfillment IN ('unfulfilled','packed')`, [number]);
    await moveStock(client, 'order_cancelled', `order/${number}`, cancelEntries.rows.map((e) => ({ sku: e.sku, location: e.location, quantity: e.quantity })));
    for (const entry of cancelEntries.rows) {
      await publishStock(client, entry.sku);
    }
    const payment = await client.query<{ card_amount: number; gift_card_amount: number; card_last4: string | null; amount: number }>(
      `SELECT card_amount, gift_card_amount, card_last4, amount FROM payments WHERE order_number = $1`, [number]);

    await client.query(`UPDATE orders SET status = 'cancelled', version = version + 1, cancelled_at = now() WHERE number = $1`, [number]);
    await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,'cancelled',now())`, [number]);
    await client.query(`UPDATE order_lines SET fulfillment = 'cancelled' WHERE order_id = $1 AND fulfillment IN ('unfulfilled','packed')`, [number]);
    await client.query(`UPDATE payments SET status = 'refunded', refunded = $2 WHERE order_number = $1`, [number, payment.rows[0].amount]);
    await client.query(`INSERT INTO refunds (order_number, amount, kind) VALUES ($1,$2,'cancellation')`, [number, payment.rows[0].amount]);
    if (payment.rows[0].gift_card_amount > 0) {
      const code = await client.query<{ gift_card_code: string | null }>(`SELECT gift_card_code FROM orders WHERE number = $1`, [number]);
      if (code.rows[0].gift_card_code !== null) {
        const g1 = await client.query<{ id: string }>(
          `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'order',$2,'refund',$3) RETURNING id::TEXT AS id`,
          [code.rows[0].gift_card_code, payment.rows[0].gift_card_amount, `order/${number}`]);
        await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(g1.rows[0].id)]);
        const g2 = await client.query<{ id: string }>(
          `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'card',$2,'refund',$3) RETURNING id::TEXT AS id`,
          [code.rows[0].gift_card_code, -payment.rows[0].gift_card_amount, `order/${number}`]);
        await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(g2.rows[0].id)]);
      }
    }
    const dc = await client.query<{ discount_code: string | null }>(`SELECT discount_code FROM orders WHERE number = $1`, [number]);
    if (dc.rows[0].discount_code !== null) {
      await client.query(`UPDATE discount_codes SET used = used - 1 WHERE code = $1`, [dc.rows[0].discount_code]);
      await client.query(`DELETE FROM discount_code_uses WHERE code = $1 AND order_number = $2`, [dc.rows[0].discount_code, number]);
    }

    const subject = `Order ${number} is cancelled`;
    const sent = await sendEmail(order.rows[0].email, subject, `Order ${number} is cancelled.\nRefund ₹${digitGroup(payment.rows[0].amount)}\n\nRoam House\n`);
    await client.query(
      `INSERT INTO notifications (user_id, text, email_status, emailed_at) VALUES ($1,$2,$3,now())`,
      [Number(order.rows[0].user_id), subject, sent ? 'emailed' : 'pending']);
    await publish(client, 'notification', { text: subject, email_status: sent ? 'emailed' : 'pending' },
      { userId: Number(order.rows[0].user_id), sessionId: null, staffVisible: true });
    await publish(client, 'order', {
      number, status: 'cancelled', payment_status: 'refunded', version: order.rows[0].version + 1,
      lines: (await client.query(`SELECT id::TEXT AS id, fulfillment, carrier, tracking_number FROM order_lines WHERE order_id = $1`, [number])).rows.map((l) => ({
        id: Number(l.id), fulfillment: l.fulfillment, shipment: l.carrier === null ? null : { carrier: l.carrier, tracking_number: l.tracking_number },
      })),
    }, { userId: Number(order.rows[0].user_id), sessionId: null, staffVisible: true });
    const ownerUserId = Number(order.rows[0].user_id);
    return orderBodyByNumber(number, ownerUserId, client);
  });
}

