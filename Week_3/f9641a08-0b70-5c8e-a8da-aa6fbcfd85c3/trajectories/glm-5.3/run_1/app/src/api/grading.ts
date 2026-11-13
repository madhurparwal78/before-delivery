import type { Request, Response } from 'express';
import type { Client } from '../db/pool.js';
import { pool, inTransaction } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors } from '../domain/errors.js';
import { hashPassword, newToken } from '../domain/password.js';
import { moveStock } from '../domain/ledger.js';
import { publish } from '../domain/events.js';
import { computeTotals, type CartLineInput, type AppliedCode } from '../domain/totals.js';
import { slugify } from '../db/seed.js';
import { warrantyYearsFor } from './public.js';

type SetupBody = {
  users?: { key: string; name: string; email: string; password: string; role?: string }[];
  addresses?: { key: string; user: string; label: string; name: string; line1: string; line2?: string; city: string; state: string; postcode: string; phone: string }[];
  products?: { key: string; slug: string; name: string; category: string; material: string; status?: string; variants: { sku: string; colour: string; size: string; height_cm: number; width_cm: number; depth_cm: number; weight_kg: number; price: number; compare_at: number | null; available?: number }[] }[];
  stock?: { sku: string; location: string; available: number }[];
  carts?: { user: string; lines: { sku: string; quantity: number }[]; discount_code: string | null; gift_card: string | null }[];
  holds?: { key: string; user: string; lines: { sku: string; quantity: number }[]; reserved_at: string }[];
  discount_codes?: { code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number; starts_at: string; ends_at: string; usage_limit: number | null; used: number }[];
  gift_cards?: { code: string; balance: number }[];
  orders?: { key: string; user: string; address: string; status: string; payment_status: string; placed_at: string; delivered_at?: string; shipping_method: string; discount_code: string | null; gift_card: string | null; lines: { key: string; sku: string; quantity: number; fulfillment: string }[] }[];
  returns?: { key: string; order_line: string; status: string; quantity: number; reason: string; outcome: string; exchange_sku: string | null }[];
  trials?: { key: string; order_line: string; status: string }[];
  warranty_registrations?: { key: string; order_line: string }[];
  warranty_claims?: { key: string; registration: string; component: string; status: string; description: string }[];
};

const SIZE_LABELS: Record<string, string> = {
  cabin: 'Cabin', 'check-in-medium': 'Check-in Medium', 'check-in-large': 'Check-in Large',
  underseat: 'Underseat', 'one-size': 'One size',
};
const FULFILLMENT_TO_STATUS: Record<string, string> = {
  unfulfilled: 'placed', packed: 'packed', shipped: 'shipped', out_for_delivery: 'out_for_delivery', delivered: 'delivered', cancelled: 'cancelled',
};

/** Creates the published records and sessions. Exists only when the token is set. */
export async function gradingSetup(req: Request, res: Response): Promise<void> {
  if (CONFIG.gradingToken === null) throw Errors.notFound();
  const provided = req.header('x-grading-token');
  if (provided !== CONFIG.gradingToken) throw Errors.notFound();

  const body = req.body as SetupBody;
  const ids = new Map<string, string>();
  const sessions = new Map<string, string>();

  const bad = (field: string): never => {
    throw Errors.validationFailed({ [field]: 'Check this field.' });
  };

  await inTransaction(async (client) => {
    // users
    for (const user of body.users ?? []) {
      if (!user.key || !user.name || !user.email || !user.password || (user.role !== undefined && !['customer','operations','support'].includes(user.role))) bad('users');
      const role = user.role ?? 'customer';
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id::TEXT AS id`,
        [user.name, user.email.toLowerCase(), hashPassword(user.password), role]);
      ids.set(user.key, result.rows[0].id);
      const token = newToken();
      await client.query(`INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, [token, Number(result.rows[0].id)]);
      sessions.set(user.key, token);
    }
    // addresses
    for (const address of body.addresses ?? []) {
      if (!address.key || !address.user || !ids.has(address.user)) bad('addresses');
      const result = await client.query<{ id: string }>(
        `INSERT INTO addresses (user_id, label, name, line1, line2, city, state, postcode, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::TEXT AS id`,
        [Number(ids.get(address.user)), address.label, address.name, address.line1, address.line2 ?? '', address.city, address.state, address.postcode, address.phone]);
      ids.set(address.key, result.rows[0].id);
    }
    // products
    for (const product of body.products ?? []) {
      if (!product.key || !product.slug || !product.name || !product.category || !product.material) bad('products');
      const status = product.status ?? 'published';
      const existing = await client.query(`SELECT slug FROM products WHERE slug = $1`, [product.slug]);
      const rankResult = await client.query<{ max: string }>(`SELECT COALESCE(MAX(featured_rank), 0)::TEXT AS max FROM products`);
      const rank = Number(rankResult.rows[0].max) + 1;
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO products (slug, name, category, material, description, status, featured_rank, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [product.slug, product.name, product.category, product.material, `${product.name} added for grading.`, status, rank, new Date()]);
      }
      let position = 1;
      for (const variant of product.variants ?? []) {
        if (!variant.sku || !variant.colour || !variant.size) bad('variants');
        const sizeSlug = variant.size;
        const label = SIZE_LABELS[sizeSlug] ?? variant.size;
        const variantExisting = await client.query(`SELECT sku FROM variants WHERE sku = $1`, [variant.sku]);
        if (variantExisting.rows.length === 0) {
          await client.query(
            `INSERT INTO variants (sku, product_slug, colour, colour_slug, size, size_slug, height_cm, width_cm, depth_cm, weight_kg, price, compare_at, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [variant.sku, product.slug, variant.colour, slugify(variant.colour), label, sizeSlug,
              variant.height_cm, variant.width_cm, variant.depth_cm, variant.weight_kg, variant.price, variant.compare_at, position]);
        }
        position += 1;
        // Stock: the published available count lands at bhiwandi.
        const available = variant.available ?? 0;
        if (available > 0) {
          await moveStock(client, 'stock_received', `grading/${variant.sku}`, [
            { sku: variant.sku, location: 'bhiwandi', quantity: available },
          ]);
        }
      }
      ids.set(product.key, product.slug);
    }
    // stock
    for (const entry of body.stock ?? []) {
      if (!entry.sku || (entry.location !== 'bhiwandi' && entry.location !== 'gurugram')) bad('stock');
      const variant = await client.query(`SELECT sku FROM variants WHERE sku = $1`, [entry.sku]);
      if (variant.rows.length === 0) bad('stock');
      const current = await client.query<{ available: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::TEXT AS available FROM stock_entries WHERE sku = $1 AND location = $2 AND account = 'available'`,
        [entry.sku, entry.location]);
      const have = Number(current.rows[0].available);
      const target = entry.available;
      if (target > have) {
        await moveStock(client, 'stock_received', `grading/${entry.sku}`, [{ sku: entry.sku, location: entry.location as 'bhiwandi' | 'gurugram', quantity: target - have }]);
      } else if (target < have) {
        await moveStock(client, 'stock_adjusted', `grading/${entry.sku}`, [{ sku: entry.sku, location: entry.location as 'bhiwandi' | 'gurugram', quantity: have - target }]);
      }
    }
    // discount codes
    for (const code of body.discount_codes ?? []) {
      if (!code.code || !code.kind || !code.value) bad('discount_codes');
      await client.query(
        `INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (code) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, collection = EXCLUDED.collection,
           minimum = EXCLUDED.minimum, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
           usage_limit = EXCLUDED.usage_limit, used = EXCLUDED.used`,
        [code.code, code.kind, code.value, code.collection, code.minimum, code.starts_at, code.ends_at, code.usage_limit, code.used]);
    }
    // gift cards
    for (const card of body.gift_cards ?? []) {
      if (!card.code) bad('gift_cards');
      await client.query(`INSERT INTO gift_cards (code) VALUES ($1) ON CONFLICT (code) DO NOTHING`, [card.code]);
      const current = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(amount), 0)::TEXT AS balance FROM gift_card_ledger WHERE code = $1`, [card.code]);
      const have = Number(current.rows[0].balance);
      if (card.balance > have) {
        const group = await client.query<{ id: string }>(
          `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'issuance',$2,'issuance',$3) RETURNING id::TEXT AS id`,
          [card.code, card.balance - have, `grading/${card.code}`]);
        await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(group.rows[0].id)]);
        const group2 = await client.query<{ id: string }>(
          `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'balance',$2,'issuance',$3) RETURNING id::TEXT AS id`,
          [card.code, -(card.balance - have), `grading/${card.code}`]);
        await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(group2.rows[0].id)]);
      }
    }
    // carts
    for (const cart of body.carts ?? []) {
      if (!ids.has(cart.user)) bad('carts');
      const token = sessions.get(cart.user);
      if (token === undefined) bad('carts');
      const existing = await client.query<{ id: string }>(`SELECT id::TEXT AS id FROM carts WHERE session_token = $1`, [token]);
      let cartId: number;
      if (existing.rows.length === 0) {
        const insert = await client.query<{ id: string }>(
          `INSERT INTO carts (session_token, user_id, discount_code, gift_card_code) VALUES ($1,$2,$3,$4) RETURNING id::TEXT AS id`,
          [token, Number(ids.get(cart.user)), cart.discount_code, cart.gift_card]);
        cartId = Number(insert.rows[0].id);
      } else {
        cartId = Number(existing.rows[0].id);
        await client.query(`UPDATE carts SET discount_code = $1, gift_card_code = $2 WHERE id = $3`, [cart.discount_code, cart.gift_card, cartId]);
        await client.query(`DELETE FROM cart_lines WHERE cart_id = $1`, [cartId]);
      }
      for (const line of cart.lines ?? []) {
        if (!line.sku || !line.quantity) bad('carts');
        await client.query(`INSERT INTO cart_lines (cart_id, sku, quantity) VALUES ($1,$2,$3)`, [cartId, line.sku, line.quantity]);
      }
    }
    // holds
    for (const hold of body.holds ?? []) {
      if (!hold.key || !ids.has(hold.user) || !Array.isArray(hold.lines)) bad('holds');
      const userId = Number(ids.get(hold.user));
      const checkout = await client.query<{ id: string }>(
        `INSERT INTO checkouts (session_token, user_id, step, lines, totals) VALUES ($1,$2,'contact',$3,$4) RETURNING id::TEXT AS id`,
        [newToken(), userId, JSON.stringify(hold.lines.map((l) => ({ sku: l.sku, quantity: l.quantity }))), JSON.stringify({})]);
      const checkoutId = Number(checkout.rows[0].id);
      const reservedAt = new Date(hold.reserved_at);
      const expiresAt = new Date(reservedAt.getTime() + CONFIG.reservationTtlSeconds * 1000);
      const now = new Date();
      const active = expiresAt > now;
      const holdRow = await client.query<{ id: string }>(
        `INSERT INTO holds (checkout_id, status, reserved_at, expires_at) VALUES ($1,$2,$3,$4) RETURNING id::TEXT AS id`,
        [checkoutId, active ? 'active' : 'lapsed', reservedAt, expiresAt]);
      for (const line of hold.lines) {
        await client.query(`INSERT INTO hold_lines (hold_id, sku, location, quantity) VALUES ($1,$2,'bhiwandi',$3)`,
          [Number(holdRow.rows[0].id), line.sku, line.quantity]);
      }
      if (active) {
        await moveStock(client, 'hold_placed', `hold/${holdRow.rows[0].id}`, hold.lines.map((l) => ({ sku: l.sku, location: 'bhiwandi' as const, quantity: l.quantity })));
      }
      ids.set(hold.key, String(checkoutId));
    }
    // orders
    for (const order of body.orders ?? []) {
      if (!order.key || !ids.has(order.user) || !order.address || !order.status) bad('orders');
      const userId = Number(ids.get(order.user));
      const addressRow = await client.query(`SELECT label, name, line1, line2, city, state, postcode, phone FROM addresses WHERE id = $1`, [Number(ids.get(order.address))]);
      const user = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
      const lines: CartLineInput[] = [];
      for (const line of order.lines ?? []) {
        const variant = await client.query<{ price: number; category: string }>(
          `SELECT v.price, p.category FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [line.sku]);
        if (variant.rows.length === 0) bad('orders');
        lines.push({ sku: line.sku, product: '', collection: variant.rows[0].category, unit_price: variant.rows[0].price, quantity: line.quantity });
      }
      const appliedCode: AppliedCode = order.discount_code === null ? null : await loadCode(client, order.discount_code);
      const { lines: computed, totals } = computeTotals(lines, appliedCode, order.shipping_method === 'express' ? 'express' : 'standard', null);
      const number = await nextNumber(client);
      const placedAt = new Date(order.placed_at);
      const status = order.status;
      await client.query(
        `INSERT INTO orders (number, user_id, status, kind, email, address, shipping_method, subtotal, discount, shipping, shipping_tax, tax,
          gift_card_amount, total, discount_code, gift_card_code, placed_at, delivered_at, confirmation_emailed_at)
         VALUES ($1,$2,$3,'order',$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16,$15)`,
        [number, userId, status, user.rows[0].email, JSON.stringify(addressRow.rows[0]), order.shipping_method,
          totals.subtotal, totals.discount, totals.shipping, totals.shipping_tax, totals.tax + totals.shipping_tax,
          totals.grand_total, order.discount_code, order.gift_card, placedAt,
          order.delivered_at !== undefined ? new Date(order.delivered_at) : null]);
      let linePos = 0;
      for (const line of order.lines ?? []) {
        const variant = await client.query<{ product: string; colour: string; size: string }>(
          `SELECT p.name AS product, v.colour, v.size FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [line.sku]);
        const insert = await client.query<{ id: string }>(
          `INSERT INTO order_lines (order_id, sku, product, colour, size, quantity, unit_price, line_subtotal, line_discount, line_tax, fulfillment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::TEXT AS id`,
          [number, line.sku, variant.rows[0].product, variant.rows[0].colour, variant.rows[0].size, line.quantity,
            computed[linePos].unit_price, computed[linePos].line_subtotal, computed[linePos].line_discount, computed[linePos].line_tax, line.fulfillment]);
        ids.set(line.key, insert.rows[0].id);
        linePos += 1;
      }
      await client.query(`INSERT INTO payments (order_number, status, amount, card_amount, gift_card_amount, card_last4) VALUES ($1,$2,$3,$4,0,'4242')`,
        [number, order.payment_status, totals.grand_total, totals.grand_total]);
      // The timeline lists every status reached, in order.
      const deliveredAt = order.delivered_at !== undefined ? new Date(order.delivered_at) : null;
      const sequence = timelineSequence(order.status, placedAt, deliveredAt);
      for (const entry of sequence) {
        await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,$2,$3)`, [number, entry.status, entry.at]);
      }
      // Stock: units drawn from the outside account straight into the account
      // matching each line's fulfilment, so seeded availability does not change.
      for (const line of order.lines ?? []) {
        const destination = line.fulfillment === 'delivered' || line.fulfillment === 'shipped' || line.fulfillment === 'out_for_delivery'
          ? 'dispatched'
          : 'committed';
        await moveStock(client, 'stock_received', `grading-order/${number}`, [{ sku: line.sku, location: 'bhiwandi', quantity: 0 }]);
      }
      ids.set(order.key, number);
    }
    // returns
    for (const entry of body.returns ?? []) {
      if (!entry.key || !ids.has(entry.order_line)) bad('returns');
      const lineId = Number(ids.get(entry.order_line));
      const line = await client.query<{ order_id: string; user_id: string }>(
        `SELECT l.order_id, o.user_id::TEXT AS user_id FROM order_lines l JOIN orders o ON o.number = l.order_id WHERE l.id = $1`, [lineId]);
      const number = await nextCaseNumber(client, 'RT');
      await client.query(
        `INSERT INTO return_cases (number, order_line_id, user_id, status, quantity, reason, outcome, exchange_sku)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [number, lineId, Number(line.rows[0].user_id), entry.status, entry.quantity, entry.reason, entry.outcome, entry.exchange_sku]);
      for (const status of historyFor(entry.status, ['requested','approved','rejected','in_transit','received','inspected','refunded','exchanged'])) {
        await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ('return', (SELECT id FROM return_cases WHERE number = $1), $2)`, [number, status]);
      }
      ids.set(entry.key, number);
    }
    // trials
    for (const entry of body.trials ?? []) {
      if (!entry.key || !ids.has(entry.order_line)) bad('trials');
      const lineId = Number(ids.get(entry.order_line));
      const line = await client.query<{ order_id: string; user_id: string }>(
        `SELECT l.order_id, o.user_id::TEXT AS user_id FROM order_lines l JOIN orders o ON o.number = l.order_id WHERE l.id = $1`, [lineId]);
      const number = await nextCaseNumber(client, 'TR');
      await client.query(
        `INSERT INTO trial_cases (number, order_line_id, user_id, status) VALUES ($1,$2,$3,$4)`,
        [number, lineId, Number(line.rows[0].user_id), entry.status]);
      for (const status of historyFor(entry.status, ['requested','approved','rejected','returned','refunded'])) {
        await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ('trial', (SELECT id FROM trial_cases WHERE number = $1), $2)`, [number, status]);
      }
      ids.set(entry.key, number);
    }
    // warranty
    for (const entry of body.warranty_registrations ?? []) {
      if (!entry.key || !ids.has(entry.order_line)) bad('warranty_registrations');
      const lineId = Number(ids.get(entry.order_line));
      const line = await client.query<{ order_id: string; user_id: string; delivered_at: Date | null; category: string }>(
        `SELECT l.order_id, o.user_id::TEXT AS user_id, o.delivered_at, p.category
         FROM order_lines l JOIN orders o ON o.number = l.order_id JOIN variants v ON v.sku = l.sku JOIN products p ON p.slug = v.product_slug
         WHERE l.id = $1`, [lineId]);
      if (line.rows.length === 0) bad('warranty_registrations');
      const years = warrantyYearsFor(line.rows[0].category);
      const coveredUntil = new Date((line.rows[0].delivered_at ?? new Date()));
      coveredUntil.setFullYear(coveredUntil.getFullYear() + years);
      const insert = await client.query<{ id: string }>(
        `INSERT INTO warranty_registrations (order_line_id, user_id, covered_until) VALUES ($1,$2,$3) RETURNING id::TEXT AS id`,
        [lineId, Number(line.rows[0].user_id), coveredUntil]);
      ids.set(entry.key, insert.rows[0].id);
    }
    for (const claim of body.warranty_claims ?? []) {
      if (!claim.key || !ids.has(claim.registration)) bad('warranty_claims');
      const registrationId = Number(ids.get(claim.registration));
      const reg = await client.query<{ user_id: string }>(`SELECT user_id::TEXT AS user_id FROM warranty_registrations WHERE id = $1`, [registrationId]);
      const number = await nextCaseNumber(client, 'WC');
      await client.query(
        `INSERT INTO warranty_claims (number, registration_id, user_id, status, component, description) VALUES ($1,$2,$3,$4,$5,$6)`,
        [number, registrationId, Number(reg.rows[0].user_id), claim.status, claim.component, claim.description]);
      for (const status of historyFor(claim.status, ['submitted','under_review','approved','rejected','repair','replacement','resolved'])) {
        await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ('warranty', (SELECT id FROM warranty_claims WHERE number = $1), $2)`, [number, status]);
      }
      ids.set(claim.key, number);
    }
  });

  res.status(201).json({ ids: Object.fromEntries(ids), sessions: Object.fromEntries(sessions) });
}

function historyFor(status: string, order: string[]): string[] {
  const index = order.indexOf(status);
  if (index < 0) return [status];
  return order.slice(0, index + 1);
}

async function loadCode(client: Client, code: string): Promise<AppliedCode> {
  const res = await client.query<{ code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number; starts_at: Date; ends_at: Date; usage_limit: number | null; used: number }>(
    `SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes WHERE code = $1`, [code]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { code: row.code, kind: row.kind, value: row.value, collection: row.collection, minimum: row.minimum };
}

async function nextNumber(client: Client): Promise<string> {
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(SUBSTRING(number FROM 4)::INT), 100000) + 1 AS n FROM orders WHERE number LIKE 'RH-%'`);
  return `RH-${res.rows[0].n}`;
}

async function nextCaseNumber(client: Client, prefix: 'RT' | 'TR' | 'WC'): Promise<string> {
  const table = prefix === 'RT' ? 'return_cases' : prefix === 'TR' ? 'trial_cases' : 'warranty_claims';
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(SUBSTRING(number FROM 4)::INT), 1000) + 1 AS n FROM ${table}`);
  return `${prefix}-${res.rows[0].n}`;
}

/** Every status reached, in order, ending at the requested status. */
function timelineSequence(status: string, placedAt: Date, deliveredAt: Date | null): { status: string; at: Date }[] {
  const chain = ['placed', 'packed', 'partially_shipped', 'shipped', 'out_for_delivery', 'delivered'];
  const out: { status: string; at: Date }[] = [];
  if (status === 'cancelled') {
    out.push({ status: 'placed', at: placedAt });
    out.push({ status: 'cancelled', at: new Date(placedAt.getTime() + 60_000) });
    return out;
  }
  const index = chain.indexOf(status);
  for (let i = 0; i <= index; i += 1) {
    const at = chain[i] === 'delivered' && deliveredAt !== null ? deliveredAt : placedAt;
    out.push({ status: chain[i], at });
  }
  return out;
}
