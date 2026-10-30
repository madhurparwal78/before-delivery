import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { isoSeconds, now } from '../clock.js';
import { one, pool, query, rows, withTransaction } from '../db.js';
import { fail, failValidation } from '../errors.js';
import { reply, type Ctx, type Router } from '../http.js';
import { accountCartId, requireCustomer } from '../auth.js';
import { boardPackage, boardPackageName } from '../domain/catalog.js';
import { loadCart, type CartShape, type Queryable } from '../domain/cart.js';
import { buildFromCode } from '../domain/buildstore.js';
import { countryRule, isCanadianPostalCode, type CountryRule } from '../domain/countries.js';
import { computeBreakdown, taxComponents, toCheckoutLine, type Breakdown, type CheckoutLine } from '../domain/checkout.js';
import { decodeCursor, encodeCursor, parseLimit } from '../domain/cursor.js';
import { chargeItems, orderConfirmationBody, orderShape, type OrderRow } from '../domain/orders.js';
import {
  PHONE_MESSAGE,
  isJsonInteger,
  isValidEmail,
  isValidPhone,
  isValidSerial,
  normaliseEmail,
} from '../domain/validate.js';
import { daysLeft, warrantyDates } from '../domain/warranty.js';
import { queueNotice } from '../services/notices.js';
import { BillingUnavailable, adjustItem, ensureAccount, recordCharge, type RecordedItem } from '../services/killbill.js';
import { addYearsInstant } from '../tz.js';

const PROTECTION_WINDOW_SECONDS = 2592000;
const PROTECTION_PRICE_CENTS: Record<number, number> = { 2: 79900, 3: 129900 };
const ORDER_KEYS = ['country', 'address', 'use_trade_in', 'use_demo_credit'];
const ADDRESS_KEYS = ['name', 'line1', 'city', 'postal_code', 'phone'];
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const TRANSFER_MESSAGE = 'Enter the email of another Tern Foils customer.';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`;
}

function requireCountry(value: unknown): CountryRule {
  const rule = countryRule(value);
  if (!rule) fail('unsupported_country');
  return rule;
}

async function checkoutLines(db: Queryable, cart: CartShape): Promise<CheckoutLine[]> {
  const out: CheckoutLine[] = [];
  for (const line of cart.lines) {
    let spares = 0;
    if (line.type === 'build' && line.code) {
      const build = await buildFromCode(db, line.code);
      spares = build?.spares ?? 0;
    }
    out.push(toCheckoutLine(line, spares));
  }
  return out;
}

interface CreditState {
  tradeInId: number | null;
  tradeInCents: number | null;
  demoCreditId: number | null;
}

async function resolveCredits(
  db: Queryable,
  userId: number,
  lines: CheckoutLine[],
  useTradeIn: boolean,
  useDemo: boolean,
  at: Date,
): Promise<CreditState> {
  const state: CreditState = { tradeInId: null, tradeInCents: null, demoCreditId: null };

  if (useTradeIn) {
    const accepted = (
      await db.query(
        `SELECT id, quote_cents FROM trade_ins WHERE user_id = $1 AND status = 'accepted' ORDER BY id LIMIT 1`,
        [userId],
      )
    ).rows[0] as { id: string; quote_cents: number } | undefined;
    if (!accepted) fail('credit_unavailable');
    if (!lines.some((line) => line.type === 'build' && line.board === 'Crest')) fail('trade_in_not_applicable');
    state.tradeInId = Number(accepted.id);
    state.tradeInCents = accepted.quote_cents;
  }

  if (useDemo) {
    const credit = (
      await db.query('SELECT id FROM demo_credits WHERE user_id = $1 AND used = false AND expires_at > $2', [userId, at])
    ).rows[0] as { id: string } | undefined;
    if (!credit) fail('credit_unavailable');
    state.demoCreditId = Number(credit.id);
  }

  return state;
}

async function breakdownFor(
  db: Queryable,
  userId: number,
  cartId: number,
  country: CountryRule,
  postalCode: string | null,
  useTradeIn: boolean,
  useDemo: boolean,
  at: Date,
): Promise<{ breakdown: Breakdown; credits: CreditState; cart: CartShape }> {
  const cart = await loadCart(db, cartId);
  const lines = await checkoutLines(db, cart);
  const credits = await resolveCredits(db, userId, lines, useTradeIn, useDemo, at);
  const breakdown = computeBreakdown({
    lines,
    discounts: cart.codes.map((code) => ({ code: code.code, amount_cents: code.amount_cents })),
    country,
    postalCode,
    tradeInCents: credits.tradeInCents,
    demoCredit: credits.demoCreditId !== null,
    at,
  });
  return { breakdown, credits, cart };
}

interface OrderAddress {
  name: string;
  line1: string;
  city: string;
  postal_code: string;
  phone: string;
}

function validateOrderBody(ctx: Ctx, country: CountryRule): OrderAddress {
  const raw = ctx.body.address;
  const address = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const unknown = Object.keys(ctx.body).filter((key) => !ORDER_KEYS.includes(key));
  const unknownAddress = Object.keys(address).filter((key) => !ADDRESS_KEYS.includes(key));
  if (unknown.length > 0 || unknownAddress.length > 0) {
    const fields: Record<string, string> = {};
    for (const key of unknown) fields[key] = 'Unknown field.';
    for (const key of unknownAddress) fields[`address.${key}`] = 'Unknown field.';
    fail('unknown_field', { fields });
  }

  const fields: Record<string, string> = {};
  const text = (value: unknown, min: number, max: number): boolean =>
    typeof value === 'string' && value.length >= min && value.length <= max;
  if (!text(address.name, 2, 80)) fields['address.name'] = 'Enter your full name.';
  if (!text(address.line1, 3, 120)) fields['address.line1'] = 'Enter your address.';
  if (!text(address.city, 2, 60)) fields['address.city'] = 'Enter your city.';
  if (!text(address.postal_code, 2, 12)) fields['address.postal_code'] = 'Enter your postal code.';
  else if (country.code === 'CA' && !isCanadianPostalCode(address.postal_code)) {
    fields['address.postal_code'] = 'Enter a valid Canadian postal code.';
  }
  if (!isValidPhone(address.phone)) fields['address.phone'] = PHONE_MESSAGE;
  if (ctx.body.use_trade_in !== undefined && typeof ctx.body.use_trade_in !== 'boolean') {
    fields.use_trade_in = 'Choose true or false.';
  }
  if (ctx.body.use_demo_credit !== undefined && typeof ctx.body.use_demo_credit !== 'boolean') {
    fields.use_demo_credit = 'Choose true or false.';
  }
  if (Object.keys(fields).length > 0) failValidation(fields);

  const postal = address.postal_code as string;
  return {
    name: address.name as string,
    line1: address.line1 as string,
    city: address.city as string,
    postal_code: country.code === 'CA' ? postal.trim().toUpperCase() : postal,
    phone: address.phone as string,
  };
}

interface RecordedCharge {
  accountId: string;
  invoiceId: string;
  orderNumber: string;
  items: RecordedItem[];
}

async function placeOrder(ctx: Ctx, userId: number, email: string): Promise<Record<string, unknown>> {
  const country = requireCountry(ctx.body.country);
  const address = validateOrderBody(ctx, country);
  const useTradeIn = ctx.body.use_trade_in === true;
  const useDemo = ctx.body.use_demo_credit === true;
  const cartId = await accountCartId(userId);
  const at = now();
  const billing: { charge: RecordedCharge | null } = { charge: null };

  try {
    return await withTransaction(async (client) => {
      const { breakdown, credits, cart } = await breakdownFor(
        client,
        userId,
        cartId,
        country,
        address.postal_code,
        useTradeIn,
        useDemo,
        at,
      );
      if (cart.lines.length === 0) fail('empty_cart');

      for (const line of [...breakdown.lines].sort((a, b) => a.sku.localeCompare(b.sku))) {
        const taken = await client.query('UPDATE stock SET stock = stock - $2 WHERE sku = $1 AND stock >= $2', [
          line.sku,
          line.quantity,
        ]);
        if ((taken.rowCount ?? 0) === 0) fail('out_of_stock', { message: `${line.sku} is out of stock.`, status: 409 });
      }

      if (credits.demoCreditId !== null) {
        const used = await client.query('UPDATE demo_credits SET used = true WHERE id = $1 AND used = false', [
          credits.demoCreditId,
        ]);
        if ((used.rowCount ?? 0) === 0) fail('credit_unavailable');
      }
      if (credits.tradeInId !== null) {
        const applied = await client.query(
          `UPDATE trade_ins SET status = 'applied' WHERE id = $1 AND status = 'accepted'`,
          [credits.tradeInId],
        );
        if ((applied.rowCount ?? 0) === 0) fail('credit_unavailable');
      }

      const counter = (
        await client.query(`UPDATE counters SET value = value + 1 WHERE name = 'order_number' RETURNING value`)
      ).rows[0] as { value: string };
      const orderNumber = `TF-${counter.value}`;

      const account = await ensureAccount({ email, name: address.name, country: country.code, orderNumber });
      await client.query('UPDATE users SET billing_account_id = $2, billing_account_key = $3 WHERE id = $1', [
        userId,
        account.accountId,
        account.externalKey,
      ]);

      const items = chargeItems(orderNumber, breakdown);
      const charge = items.length > 0 ? await recordCharge(account.accountId, orderNumber, items) : null;
      if (charge) {
        billing.charge = { accountId: account.accountId, invoiceId: charge.invoiceId, orderNumber, items: charge.items };
      }

      await client.query(
        `INSERT INTO orders (number, user_id, status, placed_at, country, addr_name, addr_line1, addr_city,
           addr_postal_code, addr_phone, subtotal_cents, discounts, credits, taxable_cents, shipping_cents,
           free_shipping, packed_batteries, standalone_batteries, dangerous_goods_cents, taxes, tax_cents,
           total_cents, ships_on, arrives_on, trade_in_id, demo_credit_id, billing_account_key, billing_invoice_id)
         VALUES ($1,$2,'placed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [
          orderNumber,
          userId,
          at,
          country.code,
          address.name,
          address.line1,
          address.city,
          address.postal_code,
          address.phone,
          breakdown.subtotal_cents,
          JSON.stringify(breakdown.discounts),
          JSON.stringify(breakdown.credits),
          breakdown.taxable_cents,
          breakdown.shipping_cents,
          breakdown.free_shipping,
          breakdown.packed_batteries,
          breakdown.standalone_batteries,
          breakdown.dangerous_goods_cents,
          JSON.stringify(breakdown.taxes),
          breakdown.tax_cents,
          breakdown.total_cents,
          breakdown.ships_on,
          breakdown.arrives_on,
          credits.tradeInId,
          credits.demoCreditId,
          account.externalKey,
          charge?.invoiceId ?? null,
        ],
      );

      for (const line of breakdown.lines) {
        await client.query(
          `INSERT INTO order_lines (order_number, type, sku, build_code, name, quantity, unit_cents, line_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [orderNumber, line.type, line.sku, line.code, line.name, line.quantity, line.unit_cents, line.line_cents],
        );
      }
      await client.query('INSERT INTO order_events (order_number, status, at, by_email) VALUES ($1,$2,$3,$4)', [
        orderNumber,
        'placed',
        at,
        email,
      ]);
      for (const item of charge?.items ?? []) {
        await client.query(
          'INSERT INTO billing_items (order_number, invoice_item_id, description, amount_cents) VALUES ($1,$2,$3,$4)',
          [orderNumber, item.invoiceItemId, item.description, item.amountCents],
        );
      }
      if (credits.demoCreditId !== null) {
        await client.query('UPDATE demo_credits SET used_order_number = $2 WHERE id = $1', [
          credits.demoCreditId,
          orderNumber,
        ]);
      }
      if (credits.tradeInId !== null) {
        await client.query('UPDATE trade_ins SET order_number = $2 WHERE id = $1', [credits.tradeInId, orderNumber]);
      }
      await client.query('DELETE FROM cart_lines WHERE cart_id = $1', [cartId]);
      await client.query('DELETE FROM cart_codes WHERE cart_id = $1', [cartId]);
      await queueNotice(
        client,
        {
          to: email,
          template: 'order_confirmed',
          reference: orderNumber,
          subject: `Order confirmed: ${orderNumber}`,
          body: orderConfirmationBody(orderNumber, breakdown.lines, breakdown),
        },
        at,
      );

      const row = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1', [orderNumber]);
      if (!row) throw new Error('Order vanished during placement');
      return orderShape(client, row);
    });
  } catch (error) {
    const settled = billing.charge;
    if (settled) {
      for (const item of settled.items) {
        await adjustItem(settled.accountId, settled.invoiceId, item, 'order_placed', settled.orderNumber).catch(
          () => undefined,
        );
      }
    }
    if (error instanceof BillingUnavailable) {
      fail('billing_unavailable', { message: 'Billing is unavailable. Your order was not placed.' });
    }
    throw error;
  }
}

async function ownedOrder(client: PoolClient, number: string, userId: number): Promise<OrderRow> {
  const row = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1 AND user_id = $2', [number, userId]);
  if (!row) fail('not_found');
  return row;
}

async function cancelOrder(userId: number, email: string, number: string): Promise<Record<string, unknown>> {
  const order = (
    await query<OrderRow & { billing_account_id: string | null }>(
      `SELECT o.*, u.billing_account_id FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.number = $1 AND o.user_id = $2`,
      [number, userId],
    )
  )[0];
  if (!order) fail('not_found');
  if (order.status !== 'placed') fail('illegal_transition', { message: 'This order cannot be changed now.' });

  const pending = await query<{ id: string; invoice_item_id: string; description: string; amount_cents: number }>(
    'SELECT id, invoice_item_id, description, amount_cents FROM billing_items WHERE order_number = $1 AND adjusted = false ORDER BY id',
    [number],
  );
  if (pending.length > 0 && order.billing_invoice_id && order.billing_account_id) {
    try {
      for (const item of pending) {
        await adjustItem(
          order.billing_account_id,
          order.billing_invoice_id,
          { invoiceItemId: item.invoice_item_id, description: item.description, amountCents: item.amount_cents },
          'order_cancelled',
          number,
        );
        await query('UPDATE billing_items SET adjusted = true WHERE id = $1', [item.id]);
      }
    } catch {
      fail('billing_unavailable', { message: 'Billing is unavailable. Your order was not cancelled.' });
    }
  }

  const at = now();
  return withTransaction(async (client) => {
    const fresh = await ownedOrder(client, number, userId);
    if (fresh.status !== 'placed') fail('illegal_transition', { message: 'This order cannot be changed now.' });
    await client.query(`UPDATE orders SET status = 'cancelled' WHERE number = $1`, [number]);
    const lines = await rows<{ sku: string; quantity: number }>(
      client,
      'SELECT sku, quantity FROM order_lines WHERE order_number = $1',
      [number],
    );
    for (const line of lines) {
      await client.query('UPDATE stock SET stock = stock + $2 WHERE sku = $1', [line.sku, line.quantity]);
    }
    await client.query('UPDATE demo_credits SET used = false, used_order_number = NULL WHERE used_order_number = $1', [
      number,
    ]);
    await client.query(
      `UPDATE trade_ins SET status = 'accepted', order_number = NULL WHERE order_number = $1 AND status = 'applied'`,
      [number],
    );
    await client.query('UPDATE protection_plans SET voided = true WHERE order_number = $1', [number]);
    await client.query('INSERT INTO order_events (order_number, status, at, by_email) VALUES ($1,$2,$3,$4)', [
      number,
      'cancelled',
      at,
      email,
    ]);
    const updated = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1', [number]);
    if (!updated) throw new Error('Order vanished during cancellation');
    return orderShape(client, updated);
  });
}

export async function listOrders(
  userId: number | null,
  limit: number,
  cursorNumber: string | null,
): Promise<{ orders: Record<string, unknown>[]; next_cursor: string | null }> {
  return withTransaction(async (client) => {
    const found = await rows<OrderRow>(
      client,
      `SELECT * FROM orders
       WHERE ($1::bigint IS NULL OR user_id = $1) AND ($2::text IS NULL OR number < $2)
       ORDER BY number DESC LIMIT $3`,
      [userId, cursorNumber, limit + 1],
    );
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    const shaped: Record<string, unknown>[] = [];
    for (const row of page) shaped.push(await orderShape(client, row));
    return { orders: shaped, next_cursor: found.length > limit && last ? encodeCursor(last.number) : null };
  });
}

interface RegistrationRow {
  serial: string;
  order_number: string;
  board_name: string;
  country: string;
  registered_at: Date;
  board_warranty_ends_on: Date | string;
  battery_warranty_ends_on: Date | string;
}

function asDateString(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function registrationShape(row: RegistrationRow, at: Date): Record<string, unknown> {
  const country = requireCountry(row.country);
  const boardEnds = asDateString(row.board_warranty_ends_on);
  const batteryEnds = asDateString(row.battery_warranty_ends_on);
  return {
    serial: row.serial,
    order_number: row.order_number,
    board_name: row.board_name,
    country: row.country,
    registered_at: isoSeconds(row.registered_at),
    board_warranty_ends_on: boardEnds,
    battery_warranty_ends_on: batteryEnds,
    board_days_left: daysLeft(boardEnds, country, at),
    battery_days_left: daysLeft(batteryEnds, country, at),
  };
}

export function registerOrderRoutes(router: Router): void {
  router.add('POST', '/api/checkout/quote', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const country = requireCountry(ctx.body.country);
    let postal: string | null = null;
    if (country.code === 'CA') {
      if (!isCanadianPostalCode(ctx.body.postal_code)) {
        failValidation({ postal_code: 'Enter a valid Canadian postal code.' });
      }
      postal = (ctx.body.postal_code as string).trim().toUpperCase();
    }
    const cartId = await accountCartId(session.userId);
    const { breakdown } = await breakdownFor(
      pool,
      session.userId,
      cartId,
      country,
      postal,
      ctx.body.use_trade_in === true,
      ctx.body.use_demo_credit === true,
      now(),
    );
    return breakdown;
  });

  router.add('POST', '/api/orders', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const key = ctx.req.headers['idempotency-key'];
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) fail('idempotency_key_required');
    const bodyHash = createHash('sha256').update(canonicalJson(ctx.body)).digest('hex');

    const claimed = await query<{ key: string }>(
      `INSERT INTO idempotency_keys (user_id, key, state, body_hash, created_at)
       VALUES ($1,$2,'in_progress',$3,$4) ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
      [session.userId, key, bodyHash, now()],
    );

    if (claimed.length === 0) {
      const existing = (
        await query<{ state: string; body_hash: string; order_number: string | null }>(
          'SELECT state, body_hash, order_number FROM idempotency_keys WHERE user_id = $1 AND key = $2',
          [session.userId, key],
        )
      )[0];
      if (!existing || existing.state === 'in_progress') fail('idempotency_in_progress');
      if (existing.body_hash !== bodyHash) fail('idempotency_conflict');
      return reply(
        200,
        await withTransaction(async (client) => {
          const row = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1', [existing.order_number]);
          if (!row) throw new Error('Stored order missing');
          return orderShape(client, row);
        }),
      );
    }

    try {
      const order = await placeOrder(ctx, session.userId, session.email);
      await query(`UPDATE idempotency_keys SET state = 'done', order_number = $3 WHERE user_id = $1 AND key = $2`, [
        session.userId,
        key,
        order.number,
      ]);
      return reply(201, order);
    } catch (error) {
      await query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [session.userId, key]);
      throw error;
    }
  });

  router.add('GET', '/api/orders', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const limit = parseLimit(ctx.url.searchParams.get('limit'));
    const cursor = ctx.url.searchParams.get('cursor');
    return listOrders(session.userId, limit, cursor ? decodeCursor(cursor) : null);
  });

  router.add('GET', '/api/orders/:number', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    return withTransaction(async (client) => {
      const order = await ownedOrder(client, ctx.params.number ?? '', session.userId);
      return orderShape(client, order);
    });
  });

  router.add('POST', '/api/orders/:number/cancel', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    return cancelOrder(session.userId, session.email, ctx.params.number ?? '');
  });

  router.add('POST', '/api/orders/:number/protection', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    return withTransaction(async (client) => {
      const order = await ownedOrder(client, ctx.params.number ?? '', session.userId);
      const termYears = ctx.body.term_years;
      const fields: Record<string, string> = {};
      if (termYears !== 2 && termYears !== 3) fields.term_years = 'Choose a 2 or 3 year term.';
      if (!isJsonInteger(ctx.body.line_id)) fields.line_id = 'Choose a board.';
      if (Object.keys(fields).length > 0) failValidation(fields);
      if (order.status === 'cancelled') fail('illegal_transition', { message: 'This order cannot be changed now.' });

      const line = await one<{ id: string; type: string }>(
        client,
        'SELECT id, type FROM order_lines WHERE id = $1 AND order_number = $2',
        [ctx.body.line_id, order.number],
      );
      if (!line) fail('not_found');
      if (line.type !== 'build') fail('not_eligible', { message: 'Protection is available for boards only.' });
      if (at.getTime() >= order.placed_at.getTime() + PROTECTION_WINDOW_SECONDS * 1000) fail('window_closed');

      const years = termYears as number;
      const priceCents = PROTECTION_PRICE_CENTS[years] as number;
      const taxes = taxComponents(priceCents, requireCountry(order.country), order.addr_postal_code);
      const taxCents = taxes.reduce((sum, tax) => sum + tax.amount_cents, 0);
      const protectedUntil = addYearsInstant(order.placed_at, years);
      const inserted = await client.query(
        `INSERT INTO protection_plans (order_number, line_id, term_years, price_cents, tax_cents, protected_until)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (line_id) DO NOTHING`,
        [order.number, line.id, years, priceCents, taxCents, protectedUntil],
      );
      if ((inserted.rowCount ?? 0) === 0) fail('already_protected');
      return reply(201, {
        line_id: Number(line.id),
        term_years: years,
        price_cents: priceCents,
        tax_cents: taxCents,
        protected_until: isoSeconds(protectedUntil),
      });
    });
  });

  router.add('POST', '/api/registrations', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const fields: Record<string, string> = {};
    if (!isJsonInteger(ctx.body.line_id)) fields.line_id = 'Choose a board.';
    if (!isValidSerial(ctx.body.serial)) fields.serial = 'Enter the serial from the deck plate, like TF123456782.';
    if (Object.keys(fields).length > 0) failValidation(fields);

    return withTransaction(async (client) => {
      const order = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1 AND user_id = $2', [
        typeof ctx.body.order_number === 'string' ? ctx.body.order_number : '',
        session.userId,
      ]);
      if (!order) fail('not_found');
      const line = await one<{ id: string; type: string; sku: string; quantity: number }>(
        client,
        'SELECT id, type, sku, quantity FROM order_lines WHERE id = $1 AND order_number = $2 FOR UPDATE',
        [ctx.body.line_id, order.number],
      );
      if (!line) fail('not_found');
      if (line.type !== 'build') fail('not_eligible', { message: 'Only boards can be registered.' });
      if (order.status !== 'delivered') fail('not_delivered');

      const taken = await one<{ count: string }>(
        client,
        'SELECT count(*) AS count FROM registrations WHERE line_id = $1',
        [line.id],
      );
      if (Number(taken?.count ?? 0) >= line.quantity) fail('nothing_to_register');

      const delivered = await one<{ at: Date }>(
        client,
        `SELECT at FROM order_events WHERE order_number = $1 AND status = 'delivered' ORDER BY id DESC LIMIT 1`,
        [order.number],
      );
      if (!delivered) fail('not_delivered');

      const country = requireCountry(order.country);
      const dates = warrantyDates(country, delivered.at);
      const pkg = boardPackage(line.sku);
      const boardName = pkg ? boardPackageName(pkg) : line.sku;
      const serial = ctx.body.serial as string;
      const inserted = await client.query(
        `INSERT INTO registrations (serial, order_number, line_id, user_id, board_name, country, registered_at,
           board_warranty_ends_on, battery_warranty_ends_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (serial) DO NOTHING`,
        [serial, order.number, line.id, session.userId, boardName, country.code, at, dates.boardEndsOn, dates.batteryEndsOn],
      );
      if ((inserted.rowCount ?? 0) === 0) fail('already_registered');
      return reply(
        201,
        registrationShape(
          {
            serial,
            order_number: order.number,
            board_name: boardName,
            country: country.code,
            registered_at: at,
            board_warranty_ends_on: dates.boardEndsOn,
            battery_warranty_ends_on: dates.batteryEndsOn,
          },
          at,
        ),
      );
    });
  });

  router.add('GET', '/api/registrations/mine', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const found = await query<RegistrationRow>(
      `SELECT serial, order_number, board_name, country, registered_at, board_warranty_ends_on, battery_warranty_ends_on
       FROM registrations WHERE user_id = $1 ORDER BY registered_at, serial`,
      [session.userId],
    );
    return { registrations: found.map((row) => registrationShape(row, at)) };
  });

  router.add('POST', '/api/registrations/:serial/transfer', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const serial = ctx.params.serial ?? '';
    const registration = (
      await query<RegistrationRow>(
        `SELECT serial, order_number, board_name, country, registered_at, board_warranty_ends_on, battery_warranty_ends_on
         FROM registrations WHERE serial = $1 AND user_id = $2`,
        [serial, session.userId],
      )
    )[0];
    if (!registration) fail('not_found');
    if (!isValidEmail(ctx.body.email)) failValidation({ email: TRANSFER_MESSAGE });

    const target = (
      await query<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND role = 'customer'`, [
        normaliseEmail(ctx.body.email as string),
      ])
    )[0];
    if (!target || Number(target.id) === session.userId) failValidation({ email: TRANSFER_MESSAGE });

    await query('UPDATE registrations SET user_id = $2 WHERE serial = $1', [serial, target.id]);
    return registrationShape(registration, at);
  });
}
