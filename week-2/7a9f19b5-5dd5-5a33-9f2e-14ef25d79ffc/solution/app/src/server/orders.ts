import { randomInt } from "node:crypto";
import type pg from "pg";
import { cardDigits, cardNumberValid, checkExpiry, cvcValid, DECLINE_TEST_CARD, postcodeValid } from "../shared/checkout.js";
import { lineTotal, orderTotals, type Totals } from "../shared/money.js";
import type { AdminOrder, Order, OrderStatus, ReportedStatus } from "../shared/types.js";
import { isApprovedTrade, USER_COLUMNS, type UserRow } from "./auth.js";
import { isClearance, unitPrice, variantByCode, variantRows, type PriceTier, type VariantRow } from "./catalogue.js";
import { dueDate, isOverdue, serverDate } from "./dates.js";
import { pool, transaction, type Queryable } from "./db.js";
import { apiError, errorCode, notFound, ProviderUnavailable } from "./errors.js";
import { Fields, type Body } from "./fields.js";
import { json, type JsonReply, type Route } from "./http.js";
import { idempotent, requestKey } from "./idempotency.js";
import * as killbill from "./killbill.js";
import { orderConfirmationMail, sendInBackground } from "./mail.js";
import { assertChange, displayStatus, isOpen, OPEN_STATUSES } from "./orderStates.js";
import { onHand, release, reserve } from "./stock.js";

const ORDER_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface OrderRow {
  id: string;
  order_key: string;
  user_id: string;
  status: OrderStatus;
  payment_method: "card" | "account" | null;
  price_tier: PriceTier | null;
  captured_cents: number;
  card_last4: string | null;
  purchase_order: string | null;
  kb_payment_id: string | null;
  kb_invoice_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  created_at: Date;
}

interface LineRow {
  variant_code: string;
  quantity: number;
  unit_price_cents: number | null;
}

interface RefundRow {
  id: string;
  amount_cents: number;
  reason: string;
  kb_transaction_id: string;
  created_at: Date;
}

/** An order with everything needed to price it and to talk about it. */
interface LoadedOrder {
  row: OrderRow;
  owner: UserRow;
  lines: { line: LineRow; variant: VariantRow; unitCents: number; totalCents: number }[];
  tier: PriceTier;
  totals: Totals;
  refunds: RefundRow[];
}

const ORDER_COLUMNS = `o.id, o.order_key, o.user_id, o.status, o.payment_method, o.price_tier, o.captured_cents,
  o.card_last4, o.purchase_order, o.kb_payment_id, o.kb_invoice_id, o.invoice_number, o.invoice_date, o.due_date,
  o.created_at`;

function newOrderKey(): string {
  let key = "LF-";
  for (let i = 0; i < 8; i++) key += ORDER_KEY_ALPHABET[randomInt(ORDER_KEY_ALPHABET.length)];
  return key;
}

/** A cart is priced at trade for an approved trade buyer and at retail for everyone else. */
function cartTier(owner: UserRow): PriceTier {
  return isApprovedTrade(owner) ? "trade" : "retail";
}

function reported(row: OrderRow): ReportedStatus {
  return row.status === "invoiced" && row.due_date && isOverdue(row.due_date) ? "overdue" : row.status;
}

/** Open orders are repriced on every read; once an order leaves the cart its stored prices are frozen. */
async function load(db: Queryable, row: OrderRow): Promise<LoadedOrder> {
  // One query at a time: inside a transaction `db` is a single client.
  const owner = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [row.user_id]);
  const lines = await db.query<LineRow>(
    "SELECT variant_code, quantity, unit_price_cents FROM order_lines WHERE order_id = $1 ORDER BY added_at, variant_code",
    [row.id],
  );
  const refunds = await db.query<RefundRow>(
    "SELECT id, amount_cents, reason, kb_transaction_id, created_at FROM refunds WHERE order_id = $1 ORDER BY seq",
    [row.id],
  );
  const variants = await variantRows(db);
  const ownerRow = owner.rows[0]!;
  const open = isOpen(row.status);
  const tier = open ? cartTier(ownerRow) : row.price_tier!;
  const priced = lines.rows.map((line) => {
    const variant = variants.find((v) => v.code === line.variant_code)!;
    const unitCents = open ? unitPrice(variant, tier) : line.unit_price_cents!;
    return { line, variant, unitCents, totalCents: lineTotal(unitCents, line.quantity) };
  });
  return {
    row,
    owner: ownerRow,
    lines: priced,
    tier,
    totals: orderTotals(priced.map((l) => l.totalCents)),
    refunds: refunds.rows,
  };
}

function serialize(order: LoadedOrder): Order {
  const { row } = order;
  const status = reported(row);
  return {
    order_key: row.order_key,
    status,
    display_status: displayStatus(status),
    payment_method: row.payment_method,
    price_tier: order.tier,
    lines: order.lines.map(({ line, variant, unitCents, totalCents }) => ({
      variant_code: line.variant_code,
      product_name: variant.product_name,
      quantity: line.quantity,
      unit_price_cents: unitCents,
      line_total_cents: totalCents,
    })),
    ...order.totals,
    captured_cents: row.captured_cents,
    refunded_cents: refunded(order),
    refunds: order.refunds.map((r) => ({
      id: r.id,
      amount_cents: r.amount_cents,
      reason: r.reason,
      kb_transaction_id: r.kb_transaction_id,
      created_at: r.created_at.toISOString(),
    })),
    card_last4: row.card_last4,
    purchase_order: row.purchase_order,
    invoice:
      row.kb_invoice_id !== null
        ? {
            kb_invoice_id: row.kb_invoice_id,
            invoice_number: row.invoice_number!,
            invoice_date: row.invoice_date!,
            due_date: row.due_date!,
          }
        : null,
    created_at: row.created_at.toISOString(),
  };
}

function refunded(order: LoadedOrder): number {
  return order.refunds.reduce((sum, r) => sum + r.amount_cents, 0);
}

async function orderByKey(db: Queryable, key: string, lock: boolean): Promise<OrderRow | null> {
  const found = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.order_key = $1${lock ? " FOR UPDATE" : ""}`,
    [key],
  );
  return found.rows[0] ?? null;
}

async function serializedByKey(key: string): Promise<Order> {
  return serialize(await load(pool, (await orderByKey(pool, key, false))!));
}

/** The caller's open order, created with a fresh order key when there is none. */
async function openCart(db: Queryable, user: UserRow, lock = false): Promise<OrderRow> {
  for (;;) {
    const found = await db.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.user_id = $1 AND o.status = ANY($2)${lock ? " FOR UPDATE" : ""}`,
      [user.id, OPEN_STATUSES],
    );
    if (found.rows[0]) return found.rows[0];
    await db.query("INSERT INTO orders (order_key, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      newOrderKey(),
      user.id,
    ]);
  }
}

async function checkStock(client: pg.PoolClient, variant: VariantRow, quantity: number): Promise<void> {
  if (!isClearance(variant)) return;
  const available = await onHand(client, variant.code);
  if (quantity > available) throw apiError(409, "insufficient_stock", { available });
}

function sendConfirmation(order: LoadedOrder): void {
  sendInBackground(
    orderConfirmationMail({
      to: order.owner.email,
      orderKey: order.row.order_key,
      onAccount: order.row.payment_method === "account",
      purchaseOrder: order.row.purchase_order,
      lines: order.lines.map((l) => ({ label: `${l.line.variant_code} x ${l.line.quantity}`, cents: l.totalCents })),
      totals: order.totals,
    }),
  );
}

/** Sends the order confirmation once per order, whichever request gets there first. */
async function confirmOnce(key: string): Promise<Order> {
  const claimed = await pool.query<OrderRow>(
    `UPDATE orders o SET confirmation_sent = true WHERE o.order_key = $1 AND NOT o.confirmation_sent RETURNING ${ORDER_COLUMNS}`,
    [key],
  );
  if (claimed.rows[0]) {
    const loaded = await load(pool, claimed.rows[0]);
    sendConfirmation(loaded);
    return serialize(loaded);
  }
  return serializedByKey(key);
}

function readDelivery(fields: Fields, body: Body): { name: string; address: string; city: string; postcode: string } {
  const delivery = new Fields(fields.object("delivery"));
  const result = {
    name: delivery.text("name", { max: 100 }),
    address: delivery.text("address", { max: 200 }),
    city: delivery.text("city", { max: 100 }),
    postcode: delivery.text("postcode", { max: 4 }),
  };
  if (result.postcode && !postcodeValid(result.postcode)) delivery.fail("postcode", "invalid");
  if (body.delivery !== undefined) fields.merge(delivery);
  return result;
}

function readCard(fields: Fields, body: Body): { digits: string } {
  const card = new Fields(fields.object("card"));
  const number = card.text("number", { max: 40 });
  if (number && !cardNumberValid(number)) card.fail("number", "invalid");
  const expiry = card.text("expiry", { max: 5 });
  const check = expiry ? checkExpiry(expiry, serverDate()) : "valid";
  if (check !== "valid") card.fail("expiry", check === "past" ? "out_of_range" : "invalid");
  const cvc = card.text("cvc", { max: 3 });
  if (cvc && !cvcValid(cvc)) card.fail("cvc", "invalid");
  card.text("name", { max: 100 });
  if (body.card !== undefined) fields.merge(card);
  return { digits: cardDigits(number) };
}

type AuthoriseOutcome = "authorised" | "declined" | "unavailable";

async function authorise(user: UserRow, key: string, body: Body): Promise<JsonReply> {
  const outcome = await transaction(async (client): Promise<AuthoriseOutcome> => {
    const row = await orderByKey(client, key, true);
    if (!row || row.user_id !== user.id) throw notFound();
    assertChange(row.status, "authorised", reported(row));
    const order = await load(client, row);
    if (!order.lines.length) throw apiError(409, "empty_cart");
    const fields = new Fields(body);
    const delivery = readDelivery(fields, body);
    const card = readCard(fields, body);
    fields.done();
    await reserve(client, key, order.lines.map((l) => ({ variantCode: l.line.variant_code, quantity: l.line.quantity })));
    const attempt = async (status: OrderStatus) => {
      assertChange(row.status, status, reported(row));
      await client.query("UPDATE orders SET status = $2, payment_method = 'card', delivery = $3 WHERE id = $1", [
        row.id,
        status,
        JSON.stringify(delivery),
      ]);
    };
    if (card.digits === DECLINE_TEST_CARD) {
      await release(client, key);
      await attempt("declined");
      return "declined";
    }
    let paymentId: string;
    try {
      paymentId = await killbill.authorize(order.owner, key, order.totals.total_cents);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
      console.error(errorCode(error));
      await release(client, key);
      await attempt("gateway_unavailable");
      return "unavailable";
    }
    for (const l of order.lines) {
      await client.query("UPDATE order_lines SET unit_price_cents = $3 WHERE order_id = $1 AND variant_code = $2", [
        row.id,
        l.line.variant_code,
        l.unitCents,
      ]);
    }
    await attempt("authorised");
    await client.query(
      "UPDATE orders SET price_tier = $2, card_last4 = $3, kb_payment_id = $4, left_cart_at = now() WHERE id = $1",
      [row.id, order.tier, card.digits.slice(-4), paymentId],
    );
    return "authorised";
  });
  if (outcome === "declined") throw apiError(402, "card_declined", { order: await serializedByKey(key) });
  if (outcome === "unavailable") throw apiError(503, "payment_unavailable", { order: await serializedByKey(key) });
  return json(200, { order: await confirmOnce(key) });
}

async function placeOnAccount(user: UserRow, key: string, body: Body): Promise<JsonReply> {
  await transaction(async (client) => {
    const row = await orderByKey(client, key, true);
    if (!row || row.user_id !== user.id) throw notFound();
    if (!isApprovedTrade(user)) throw apiError(403, "trade_account_required");
    assertChange(row.status, "placed", reported(row));
    const order = await load(client, row);
    if (!order.lines.length) throw apiError(409, "empty_cart");
    const fields = new Fields(body);
    const delivery = readDelivery(fields, body);
    const purchaseOrder = fields.optionalText("purchase_order", 40);
    fields.done();
    await reserve(client, key, order.lines.map((l) => ({ variantCode: l.line.variant_code, quantity: l.line.quantity })));
    for (const l of order.lines) {
      await client.query("UPDATE order_lines SET unit_price_cents = $3 WHERE order_id = $1 AND variant_code = $2", [
        row.id,
        l.line.variant_code,
        l.unitCents,
      ]);
    }
    await client.query(
      `UPDATE orders SET status = 'placed', payment_method = 'account', price_tier = $2, purchase_order = $3,
         delivery = $4, left_cart_at = now() WHERE id = $1`,
      [row.id, order.tier, purchaseOrder, JSON.stringify(delivery)],
    );
  });
  return json(200, { order: await confirmOnce(key) });
}

/** Runs an admin money action on a locked order; Kill Bill failures roll back and answer the outage 503. */
async function withLockedOrder<T>(key: string, work: (client: pg.PoolClient, order: LoadedOrder) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    const row = await orderByKey(client, key, true);
    if (!row) throw notFound();
    return work(client, await load(client, row));
  });
}

async function dispatch(key: string): Promise<JsonReply> {
  await withLockedOrder(key, async (client, order) => {
    const { row } = order;
    if (row.payment_method === "card") {
      assertChange(row.status, "captured", reported(row));
      await killbill.capture(row.kb_payment_id!, key, order.totals.total_cents);
      await client.query("UPDATE orders SET status = 'captured', captured_cents = $2 WHERE id = $1", [
        row.id,
        order.totals.total_cents,
      ]);
      return;
    }
    assertChange(row.status, "invoiced", reported(row));
    const invoice = await killbill.invoiceCharges(order.owner, [
      ...order.lines.map((l) => ({ description: `${l.line.variant_code} x ${l.line.quantity}`, amountCents: l.totalCents })),
      { description: "GST 15%", amountCents: order.totals.gst_cents },
    ]);
    const invoiceDate = serverDate();
    await client.query(
      `UPDATE orders SET status = 'invoiced', kb_invoice_id = $2, invoice_number = $3, invoice_date = $4, due_date = $5
       WHERE id = $1`,
      [row.id, invoice.invoiceId, invoice.invoiceNumber, invoiceDate, dueDate(invoiceDate)],
    );
  });
  return json(200, { order: await serializedByKey(key) });
}

async function refundOrder(key: string, body: Body): Promise<JsonReply> {
  const refund = await withLockedOrder(key, async (client, order) => {
    const { row } = order;
    // Refunds start from a captured or partly refunded order; the exact target is checked once the amount is known.
    assertChange(row.status, "partially_refunded", reported(row));
    const fields = new Fields(body);
    const amount = fields.int("amount_cents", { min: 1, max: 100_000_000 });
    const reason = fields.text("reason", { max: 200 });
    fields.done();
    const refundable = row.captured_cents - refunded(order);
    if (amount > refundable) fields.fail("amount_cents", "exceeds_refundable");
    fields.done();
    const target = amount === refundable ? "refunded" : "partially_refunded";
    assertChange(row.status, target, reported(row));
    const sequence = order.refunds.length + 1;
    const transactionId = await killbill.refund(row.kb_payment_id!, key, sequence, amount);
    const inserted = await client.query<RefundRow>(
      `INSERT INTO refunds (order_id, seq, amount_cents, reason, kb_transaction_id) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, amount_cents, reason, kb_transaction_id, created_at`,
      [row.id, sequence, amount, reason, transactionId],
    );
    await client.query("UPDATE orders SET status = $2 WHERE id = $1", [row.id, target]);
    return inserted.rows[0]!;
  });
  return json(201, {
    refund: { ...refund, created_at: refund.created_at.toISOString() },
    order: await serializedByKey(key),
  });
}

async function recordPayment(key: string, body: Body): Promise<JsonReply> {
  await withLockedOrder(key, async (client, order) => {
    const { row } = order;
    assertChange(row.status, "paid", reported(row));
    const fields = new Fields(body);
    const amount = fields.int("amount_cents", { min: 0, max: 100_000_000 });
    fields.done();
    if (amount !== order.totals.total_cents) fields.fail("amount_cents", "must_equal_balance");
    fields.done();
    await killbill.payInvoice(order.owner, row.kb_invoice_id!, key, amount);
    await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [row.id]);
  });
  return json(200, { order: await serializedByKey(key) });
}

function cartLineFields(body: Body, min: number): { code: string | null; quantity: number; fields: Fields } {
  const fields = new Fields(body);
  const quantity = fields.int("quantity", { min, max: 999 });
  return { code: typeof body.variant_code === "string" ? body.variant_code : null, quantity, fields };
}

export const orderRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/cart",
    access: "user",
    async handler({ user }) {
      return json(200, { order: serialize(await load(pool, await openCart(pool, user!))) });
    },
  },
  {
    method: "POST",
    path: "/api/cart/lines",
    access: "user",
    async handler({ body, user }) {
      const { code, quantity, fields } = cartLineFields(body, 1);
      const variant = code ? await variantByCode(code) : null;
      if (code && !variant) throw notFound();
      if (!code) fields.fail("variant_code", "required");
      fields.done();
      const order = await transaction(async (client) => {
        const cart = await openCart(client, user!, true);
        const existing = await client.query<{ quantity: number }>(
          "SELECT quantity FROM order_lines WHERE order_id = $1 AND variant_code = $2",
          [cart.id, variant!.code],
        );
        const total = (existing.rows[0]?.quantity ?? 0) + quantity;
        if (total > 999) fields.fail("quantity", "out_of_range");
        fields.done();
        await checkStock(client, variant!, total);
        await client.query(
          `INSERT INTO order_lines (order_id, variant_code, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (order_id, variant_code) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [cart.id, variant!.code, total],
        );
        return load(client, cart);
      });
      return json(200, { order: serialize(order) });
    },
  },
  {
    method: "PATCH",
    path: "/api/cart/lines/:code",
    access: "user",
    async handler({ body, params, user }) {
      const variant = await variantByCode(params.code!);
      if (!variant) throw notFound();
      const { quantity, fields } = cartLineFields(body, 0);
      const order = await transaction(async (client) => {
        const cart = await openCart(client, user!, true);
        const existing = await client.query("SELECT 1 FROM order_lines WHERE order_id = $1 AND variant_code = $2", [
          cart.id,
          variant.code,
        ]);
        if (!existing.rowCount) throw notFound();
        fields.done();
        if (quantity === 0) {
          await client.query("DELETE FROM order_lines WHERE order_id = $1 AND variant_code = $2", [cart.id, variant.code]);
        } else {
          await checkStock(client, variant, quantity);
          await client.query("UPDATE order_lines SET quantity = $3 WHERE order_id = $1 AND variant_code = $2", [
            cart.id,
            variant.code,
            quantity,
          ]);
        }
        return load(client, cart);
      });
      return json(200, { order: serialize(order) });
    },
  },
  {
    method: "POST",
    path: "/api/orders/:orderKey/authorise",
    access: "user",
    async handler({ req, url, body, params, user }) {
      const key = requestKey(req);
      return idempotent(`${user!.id} POST ${url.pathname}`, key, body, () => authorise(user!, params.orderKey!, body));
    },
  },
  {
    method: "POST",
    path: "/api/orders/:orderKey/place-on-account",
    access: "user",
    async handler({ req, url, body, params, user }) {
      const key = requestKey(req);
      return idempotent(`${user!.id} POST ${url.pathname}`, key, body, () => placeOnAccount(user!, params.orderKey!, body));
    },
  },
  {
    method: "GET",
    path: "/api/orders",
    access: "user",
    async handler({ user }) {
      const rows = await pool.query<OrderRow>(
        `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.user_id = $1 AND NOT (o.status = ANY($2))
         ORDER BY coalesce(o.left_cart_at, o.created_at) DESC`,
        [user!.id, OPEN_STATUSES],
      );
      return json(200, { orders: await Promise.all(rows.rows.map(async (row) => serialize(await load(pool, row)))) });
    },
  },
  {
    method: "GET",
    path: "/api/orders/:orderKey",
    access: "user",
    async handler({ params, user }) {
      const row = await orderByKey(pool, params.orderKey!, false);
      if (!row || (row.user_id !== user!.id && user!.role !== "admin")) throw notFound();
      return json(200, { order: serialize(await load(pool, row)) });
    },
  },
  {
    method: "GET",
    path: "/api/admin/orders",
    access: "user",
    async handler() {
      const rows = await pool.query<OrderRow>(
        `SELECT ${ORDER_COLUMNS} FROM orders o WHERE NOT (o.status = ANY($1))
         ORDER BY coalesce(o.left_cart_at, o.created_at) DESC`,
        [OPEN_STATUSES],
      );
      const orders: AdminOrder[] = await Promise.all(
        rows.rows.map(async (row) => {
          const loaded = await load(pool, row);
          return { ...serialize(loaded), customer_email: loaded.owner.email };
        }),
      );
      return json(200, { orders });
    },
  },
  {
    method: "POST",
    path: "/api/admin/orders/:orderKey/dispatch",
    access: "user",
    handler: ({ params }) => dispatch(params.orderKey!),
  },
  {
    method: "POST",
    path: "/api/admin/orders/:orderKey/refunds",
    access: "user",
    async handler({ req, url, body, params, user }) {
      const key = requestKey(req);
      return idempotent(`${user!.id} POST ${url.pathname}`, key, body, () => refundOrder(params.orderKey!, body));
    },
  },
  {
    method: "POST",
    path: "/api/admin/orders/:orderKey/record-payment",
    access: "user",
    handler: ({ params, body }) => recordPayment(params.orderKey!, body),
  },
];

