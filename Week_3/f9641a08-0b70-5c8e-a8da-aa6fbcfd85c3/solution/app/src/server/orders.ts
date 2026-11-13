import type { AddressFields, Fulfillment, Order, OrderLine, OrderStatus, OrderSummary, PaymentStatus, ShippingMethod } from "../shared/api";
import { TIMELINE_LABELS, inr } from "../shared/format";
import type { Session } from "./auth";
import { sizeLabel } from "./catalogue";
import { checkDiscount } from "./codes";
import { checkoutLines, holdOf, loadOwned, reserveHold, settingsOf } from "./checkout";
import { emit, one, pool, rows, type Db, type Queryable, type Unit } from "./db";
import { alreadyRedeemed, fail, validation } from "./errors";
import * as giftcards from "./giftcards";
import { once, fingerprint, lookupStored, type Stored } from "./idempotency";
import { notify, orderSubject, placedSubject, sendWithin } from "./notifications";
import { refundOrder } from "./refunds";
import { lapseExpiredHolds, lockVariants, move, type Chunk, type Location } from "./stock";
import { compute } from "./totals";
import { checkCard, isIdempotencyKey, type Fields } from "./validate";
import { hasTrial, lineFactsFor, returnEnd, returnVerdict, trialEnd, trialVerdict, windowState } from "./windows";
import { FIELD } from "./errors";

// Orders: placement (all or nothing), the body every screen reads, the status timeline, cancellation.

interface OrderRow {
  id: string;
  number: string;
  user_id: string;
  kind: "sale" | "exchange" | "replacement";
  status: OrderStatus;
  payment_base: "pending" | "authorized" | "captured" | "failed";
  placed_at: Date;
  delivered_at: Date | null;
  version: number;
  email: string | null;
  phone: string | null;
  address: AddressFields | null;
  shipping_method: ShippingMethod;
  gift_message: string;
  discount_code: string | null;
  gift_card_code: string | null;
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  shipping_tax: number;
  grand_total: number;
  gift_card_amount: number;
  card_amount: number;
  card_last4: string | null;
  confirmation_emailed_at: Date | null;
}

const ORDER_COLUMNS = `id, number, user_id, kind, status, payment_base, placed_at, delivered_at, version, email, phone, address, shipping_method, gift_message,
  discount_code, gift_card_code, subtotal, discount, shipping, tax, shipping_tax, grand_total, gift_card_amount, card_amount, card_last4, confirmation_emailed_at`;

export async function findByNumber(db: Queryable, number: string, userId?: string, lock = false): Promise<OrderRow> {
  const order = await one<OrderRow>(db, `SELECT ${ORDER_COLUMNS} FROM orders WHERE number = $1 ${userId ? "AND user_id = $2" : ""} ${lock ? "FOR UPDATE" : ""}`, userId ? [number, userId] : [number]);
  if (!order) throw fail("not_found");
  return order;
}

export async function findLine(db: Queryable, lineId: string, userId: string): Promise<{ id: string; order_id: string }> {
  const line = /^[0-9a-f-]{36}$/.test(lineId)
    ? await one<{ id: string; order_id: string }>(db, "SELECT l.id, l.order_id FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = $1 AND o.user_id = $2", [lineId, userId])
    : null;
  if (!line) throw fail("not_found");
  return line;
}

interface NewLine {
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  fulfillment: Fulfillment;
  allocations: Chunk[];
}

interface NewOrder {
  userId: string;
  kind: OrderRow["kind"];
  status: OrderStatus;
  paymentBase: OrderRow["payment_base"];
  placedAt: Date;
  deliveredAt: Date | null;
  email: string | null;
  phone: string | null;
  address: AddressFields | null;
  shippingMethod: ShippingMethod;
  gift: boolean;
  giftMessage: string;
  discountCode: string | null;
  giftCardCode: string | null;
  lines: NewLine[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  shippingTax: number;
  grand: number;
  giftCardAmount: number;
  cardAmount: number;
  cardLast4: string | null;
  confirmationEmailedAt: Date | null;
  /** Every status reached, with its time. */
  events: { status: OrderStatus; at: Date }[];
}

export async function insertOrder(db: Db, o: NewOrder): Promise<{ id: string; number: string; lineIds: string[] }> {
  const { rows: [seq] } = await db.query<{ n: number }>("SELECT nextval('order_number_seq') AS n");
  const number = `RH-${seq?.n}`;
  const { rows: [created] } = await db.query<{ id: string }>(
    `INSERT INTO orders (number, user_id, kind, status, payment_base, placed_at, delivered_at, email, phone, address, shipping_method, gift, gift_message,
       discount_code, gift_card_code, subtotal, discount, shipping, tax, shipping_tax, grand_total, gift_card_amount, card_amount, card_last4, confirmation_emailed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
    [number, o.userId, o.kind, o.status, o.paymentBase, o.placedAt, o.deliveredAt, o.email, o.phone, o.address ? JSON.stringify(o.address) : null, o.shippingMethod, o.gift,
      o.giftMessage, o.discountCode, o.giftCardCode, o.subtotal, o.discount, o.shipping, o.tax, o.shippingTax, o.grand, o.giftCardAmount, o.cardAmount, o.cardLast4, o.confirmationEmailedAt],
  );
  if (!created) throw new Error("order inserted");
  const lineIds: string[] = [];
  let position = 0;
  for (const line of o.lines) {
    const { rows: [inserted] } = await db.query<{ id: string }>(
      `INSERT INTO order_lines (order_id, position, sku, product_name, colour, size_slug, quantity, unit_price, line_discount, line_tax, fulfillment)
       SELECT $1, $2, v.sku, p.name, v.colour, v.size_slug, $4, $5, $6, $7, $8 FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = $3 RETURNING id`,
      [created.id, position, line.sku, line.quantity, line.unitPrice, line.discount, line.tax, line.fulfillment],
    );
    if (!inserted) throw new Error("order line inserted");
    for (const chunk of line.allocations) await db.query("INSERT INTO order_allocations (order_line_id, location, quantity) VALUES ($1, $2, $3)", [inserted.id, chunk.location, chunk.quantity]);
    lineIds.push(inserted.id);
    position += 1;
  }
  for (const event of o.events) await db.query("INSERT INTO order_events (order_id, status, at) VALUES ($1, $2, $3)", [created.id, event.status, event.at]);
  return { id: created.id, number, lineIds };
}

export async function refundedOf(db: Queryable, orderId: string): Promise<number> {
  return (await one<{ n: number }>(db, "SELECT coalesce(sum(amount), 0) AS n FROM refunds WHERE order_id = $1", [orderId]))?.n ?? 0;
}

/** Payment status: the base state until money goes back, then partially_refunded or refunded. */
export function paymentStatus(order: Pick<OrderRow, "payment_base" | "grand_total">, refunded: number): PaymentStatus {
  if (refunded <= 0) return order.payment_base;
  return refunded >= order.grand_total ? "refunded" : "partially_refunded";
}

interface LineRow {
  id: string;
  sku: string;
  product_name: string;
  colour: string;
  size_slug: string;
  quantity: number;
  unit_price: number;
  line_discount: number;
  line_tax: number;
  fulfillment: Fulfillment;
  carrier: string | null;
  tracking_number: string | null;
  category: string;
  product_id: string;
  registration_id: string | null;
  covered_until: Date | null;
}

export async function orderLines(db: Queryable, orderId: string): Promise<LineRow[]> {
  return rows<LineRow>(
    db,
    `SELECT l.id, l.sku, l.product_name, l.colour, l.size_slug, l.quantity, l.unit_price, l.line_discount, l.line_tax, l.fulfillment, l.carrier, l.tracking_number,
            p.category, p.id AS product_id, r.id AS registration_id, r.covered_until
     FROM order_lines l JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id
     LEFT JOIN warranty_registrations r ON r.order_line_id = l.id
     WHERE l.order_id = $1 ORDER BY l.position`,
    [orderId],
  );
}

export async function orderBody(db: Queryable, order: OrderRow, now: Date): Promise<Order> {
  const lines = await orderLines(db, order.id);
  const facts = await lineFactsFor(db, lines.map((l) => l.id));
  const events = await rows<{ status: OrderStatus; at: Date }>(db, "SELECT status, at FROM order_events WHERE order_id = $1 ORDER BY id", [order.id]);
  const refunded = await refundedOf(db, order.id);
  const others = await rows<{ sku: string; product_id: string; colour: string; size_slug: string; price: number; available: number }>(
    db,
    `SELECT v.sku, v.product_id, v.colour, v.size_slug, v.price,
            coalesce((SELECT sum(e.quantity) FROM stock_entries e WHERE e.sku = v.sku AND e.account = 'available'), 0) AS available
     FROM variants v WHERE v.product_id = ANY($1) ORDER BY v.product_id, v.position`,
    [lines.map((l) => l.product_id)],
  );
  const delivered = order.delivered_at;
  const bodyLines: OrderLine[] = lines.map((l) => {
    const f = facts.get(l.id);
    const returnOk = f ? returnVerdict({ ...f, quantity: l.quantity, category: l.category, delivered: l.fulfillment === "delivered", deliveredAt: delivered }, 1, now).ok && !f.openCase : false;
    const trialOk = f ? trialVerdict({ ...f, quantity: l.quantity, category: l.category, delivered: l.fulfillment === "delivered", deliveredAt: delivered }, now).ok && !f.openCase : false;
    return {
      id: l.id,
      sku: l.sku,
      product: l.product_name,
      colour: l.colour,
      size: sizeLabel(l.size_slug),
      quantity: l.quantity,
      unit_price: l.unit_price,
      line_subtotal: l.unit_price * l.quantity,
      line_discount: l.line_discount,
      line_tax: l.line_tax,
      fulfillment: l.fulfillment,
      shipment: l.carrier && l.tracking_number ? { carrier: l.carrier, tracking_number: l.tracking_number } : null,
      return_eligible: returnOk,
      trial_eligible: trialOk,
      warranty: l.registration_id && l.covered_until ? { registration_id: l.registration_id, covered_until: l.covered_until.toISOString() } : null,
      exchange_options: others
        .filter((o) => o.product_id === l.product_id && o.sku !== l.sku && o.price === l.unit_price)
        .map((o) => ({ sku: o.sku, colour: o.colour, size: sizeLabel(o.size_slug), available: o.available })),
      trial_category: hasTrial(l.category),
    };
  });
  return {
    number: order.number,
    status: order.status,
    version: order.version,
    placed_at: order.placed_at.toISOString(),
    delivered_at: delivered ? delivered.toISOString() : null,
    confirmation_emailed_at: order.confirmation_emailed_at ? order.confirmation_emailed_at.toISOString() : null,
    payment: {
      status: paymentStatus(order, refunded),
      amount: order.grand_total,
      card_amount: order.card_amount,
      gift_card_amount: order.gift_card_amount,
      card_last4: order.card_last4,
      refunded,
    },
    lines: bodyLines,
    totals: { subtotal: order.subtotal, discount: order.discount, shipping: order.shipping, tax: order.tax, gift_card: order.gift_card_amount, total: order.card_amount },
    shipping_tax: order.shipping_tax,
    timeline: events.map((e) => ({ status: e.status, label: TIMELINE_LABELS[e.status] ?? e.status, at: e.at.toISOString() })),
    return_window: windowState(delivered ? returnEnd(delivered) : null, now),
    trial_window: windowState(delivered ? trialEnd(delivered) : null, now),
    server_time: now.toISOString(),
    email: order.email,
    address: order.address,
    shipping_method: order.shipping_method,
    gift_message: order.gift_message || null,
  };
}

export async function listFor(db: Queryable, userId: string): Promise<OrderSummary[]> {
  const found = await rows<{ number: string; status: OrderStatus; placed_at: Date; card_amount: number; grand_total: number }>(
    db,
    "SELECT number, status, placed_at, card_amount, grand_total FROM orders WHERE user_id = $1 ORDER BY placed_at DESC, number DESC",
    [userId],
  );
  return found.map((o) => ({ number: o.number, status: o.status, placed_at: o.placed_at.toISOString(), total: o.grand_total }));
}

/** Pushes the order's new state to its owner and to staff. */
export async function announceOrder(u: Unit, order: OrderRow): Promise<void> {
  const lines = await orderLines(u.db, order.id);
  const current = await one<{ status: OrderStatus; version: number }>(u.db, "SELECT status, version FROM orders WHERE id = $1", [order.id]);
  const refunded = await refundedOf(u.db, order.id);
  emit(u, "order", {
    number: order.number,
    status: current?.status ?? order.status,
    payment_status: paymentStatus(order, refunded),
    version: current?.version ?? order.version,
    lines: lines.map((l) => ({ id: l.id, fulfillment: l.fulfillment, shipment: l.carrier && l.tracking_number ? { carrier: l.carrier, tracking_number: l.tracking_number } : null })),
  }, "owner", `user:${order.user_id}`);
  emit(u, "queue", { kind: "order", number: order.number, status: current?.status ?? order.status }, "staff");
}

/** Records a status reached: the timeline item, the version bump and the customer email, all in the caller's transaction. */
export async function reach(u: Unit, order: OrderRow, status: OrderStatus, at: Date): Promise<void> {
  await u.db.query("UPDATE orders SET status = $2, version = version + 1 WHERE id = $1", [order.id, status]);
  await u.db.query("INSERT INTO order_events (order_id, status, at) VALUES ($1, $2, $3)", [order.id, status, at]);
  await notify(u, order.user_id, orderSubject(order.number, status), `Your order ${order.number} is now ${TIMELINE_LABELS[status] ?? status}.`, at);
}

interface Allocation {
  line_id: string;
  location: Location;
  quantity: number;
  sku: string;
}

export async function allocationsOf(db: Queryable, orderId: string): Promise<Allocation[]> {
  return rows<Allocation>(
    db,
    `SELECT a.order_line_id AS line_id, a.location, a.quantity, l.sku FROM order_allocations a JOIN order_lines l ON l.id = a.order_line_id
     WHERE l.order_id = $1 ORDER BY a.id`,
    [orderId],
  );
}

/** Full refund to the card and gift card, stock back to available, code use released. Placed or packed orders only. */
export async function cancelOrder(u: Unit, order: OrderRow, at: Date): Promise<void> {
  if (order.status !== "placed" && order.status !== "packed") throw fail("invalid_transition");
  const allocations = await allocationsOf(u.db, order.id);
  await lockVariants(u.db, allocations.map((a) => a.sku));
  for (const a of allocations) {
    await move(u.db, { sku: a.sku, location: a.location, reason: "order_cancelled", ref: `order:${order.number}`, from: "committed", to: "available", quantity: a.quantity, at });
  }
  await u.db.query("UPDATE order_lines SET fulfillment = 'cancelled' WHERE order_id = $1", [order.id]);
  const refunded = await refundedOf(u.db, order.id);
  await refundOrder(u, order, order.grand_total - refunded, "cancellation", at);
  await reach(u, order, "cancelled", at);
  await announceOrder(u, order);
}

// ---- placement ----------------------------------------------------------------------------

const DECLINED = "4000000000000002";
const NO_FUNDS = "4000000000009995";

export async function place(session: Session, userId: string, email: string, input: Record<string, unknown>, key: string | null, now: Date): Promise<Stored> {
  try {
    return await placeOnce(session, userId, email, input, key, now);
  } catch (failure) {
    // A repeat that read the checkout just after the first request committed finds it placed: answer with the stored order.
    if (!isIdempotencyKey(key)) throw failure;
    const stored = await lookupStored(pool, `${userId}:POST /api/orders`, key, fingerprint("POST", "/api/orders", input));
    if (stored) return stored;
    throw failure;
  }
}

async function placeOnce(session: Session, userId: string, email: string, input: Record<string, unknown>, key: string | null, now: Date): Promise<Stored> {
  const checkoutId = typeof input.checkout_id === "string" ? input.checkout_id : "";
  await loadOwned(pool, checkoutId, userId);
  const scope = `${userId}:POST /api/orders`;
  const print = fingerprint("POST", "/api/orders", input);
  if (isIdempotencyKey(key)) {
    const stored = await lookupStored(pool, scope, key, print);
    if (stored) return stored;
  }
  await lapseExpiredHolds();
  const checkout = await loadOwned(pool, checkoutId, userId);
  if (checkout.placed_order_id) throw fail("invalid_transition");
  const hold = await holdOf(pool, checkout, now);
  if (hold.status === "expired") throw fail("reservation_expired");

  const lines = await checkoutLines(pool, checkoutId);
  const settings = await settingsOf(pool, session.owner);
  const rule = settings.discount_code ? await checkDiscount(pool, settings.discount_code, lines.map(toPriced), now) : null;
  const shown = checkout.gift_card_shown;
  if (settings.gift_card_code && shown !== null) {
    const balance = await giftcards.balanceOf(pool, settings.gift_card_code);
    if (balance < shown) throw alreadyRedeemed(balance);
  }
  const balance = settings.gift_card_code ? (shown ?? (await giftcards.balanceOf(pool, settings.gift_card_code))) : 0;
  const totals = compute(lines.map(toPriced), rule, settings.shipping_method, balance).totals;

  const fields: Fields = {};
  if (!isIdempotencyKey(key)) fields["Idempotency-Key"] = FIELD.idempotencyKey;
  const card = totals.total > 0 ? checkCard(input.card, fields, now) : null;
  if (Object.keys(fields).length > 0) throw validation(fields);
  if (!isIdempotencyKey(key)) throw new Error("the key was validated above");
  if (hold.status === "none") await reserveHold(session, userId, checkoutId);

  if (card && (card.number === DECLINED || card.number === NO_FUNDS)) {
    await pool.query("UPDATE checkouts SET payment_failed = true WHERE id = $1", [checkoutId]);
    throw fail(card.number === DECLINED ? "card_declined" : "insufficient_funds");
  }
  return once(scope, key, print, (u) => commitOrder(u, session, userId, email, checkoutId, card?.number.slice(-4) ?? null, now));
}

function toPriced(l: { id: string; price: number; quantity: number; category: string }) {
  return { id: l.id, unitPrice: l.price, quantity: l.quantity, category: l.category };
}

async function commitOrder(u: Unit, session: Session, userId: string, email: string, checkoutId: string, last4: string | null, now: Date): Promise<{ status: number; body: object }> {
  const checkout = await loadOwned(u.db, checkoutId, userId, true);
  if (checkout.placed_order_id) throw fail("invalid_transition");
  const hold = await holdOf(u.db, checkout, now);
  if (hold.status !== "active") throw fail("reservation_expired");
  const lines = await checkoutLines(u.db, checkoutId);
  const settings = await settingsOf(u.db, session.owner);
  const rule = settings.discount_code ? await checkDiscount(u.db, settings.discount_code, lines.map(toPriced), now) : null;
  let giftBalance = 0;
  if (settings.gift_card_code) {
    await giftcards.lockCard(u.db, settings.gift_card_code);
    const live = await giftcards.balanceOf(u.db, settings.gift_card_code);
    const shown = checkout.gift_card_shown ?? live;
    if (live < shown) throw alreadyRedeemed(live);
    giftBalance = shown;
  }
  const result = compute(lines.map(toPriced), rule, settings.shipping_method, giftBalance);
  const chunks = await rows<{ id: number; sku: string; location: Location; quantity: number }>(u.db, "SELECT id, sku, location, quantity FROM hold_chunks WHERE checkout_id = $1 AND state = 'active' ORDER BY id FOR UPDATE", [checkoutId]);
  await lockVariants(u.db, chunks.map((c) => c.sku));
  const byId = new Map(result.lines.map((a) => [a.id, a]));
  const order = await insertOrder(u.db, {
    userId,
    kind: "sale",
    status: "placed",
    paymentBase: "captured",
    placedAt: now,
    deliveredAt: null,
    email,
    phone: checkout.contact?.phone ?? null,
    address: checkout.delivery?.address ?? null,
    shippingMethod: settings.shipping_method,
    gift: checkout.gift,
    giftMessage: checkout.gift_message,
    discountCode: rule ? settings.discount_code : null,
    giftCardCode: result.totals.gift_card > 0 ? settings.gift_card_code : null,
    lines: lines.map((l) => ({
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.price,
      discount: byId.get(l.id)?.discount ?? 0,
      tax: byId.get(l.id)?.tax ?? 0,
      fulfillment: "unfulfilled" as const,
      allocations: chunks.filter((c) => c.sku === l.sku).map((c) => ({ location: c.location, quantity: c.quantity })),
    })),
    subtotal: result.totals.subtotal,
    discount: result.totals.discount,
    shipping: result.totals.shipping,
    tax: result.totals.tax,
    shippingTax: result.shippingTax,
    grand: result.grand,
    giftCardAmount: result.totals.gift_card,
    cardAmount: result.totals.total,
    cardLast4: result.totals.total > 0 ? last4 : null,
    confirmationEmailedAt: now,
    events: [{ status: "placed", at: now }],
  });
  for (const chunk of chunks) {
    await move(u.db, { sku: chunk.sku, location: chunk.location, reason: "order_committed", ref: `order:${order.number}`, from: "reserved", to: "committed", quantity: chunk.quantity, at: now });
    await u.db.query("UPDATE hold_chunks SET state = 'committed' WHERE id = $1", [chunk.id]);
  }
  if (result.totals.gift_card > 0 && settings.gift_card_code) await giftcards.spend(u.db, settings.gift_card_code, result.totals.gift_card, order.number, now);
  await u.db.query("DELETE FROM cart_lines WHERE owner = $1", [session.owner]);
  await u.db.query("UPDATE carts SET shipping_method = 'standard', discount_code = NULL, gift_card_code = NULL WHERE owner = $1", [session.owner]);
  await u.db.query("UPDATE checkouts SET placed_order_id = $2 WHERE id = $1", [checkoutId, order.id]);
  const notification = await notify(u, userId, placedSubject(order.number), `Your order ${order.number} is placed. Total ${inr(result.grand)}.`, now);
  try {
    await sendWithin(u, notification, now);
  } catch {
    throw fail("email_unavailable");
  }
  emit(u, "cart", { count: 0 }, "owner", session.owner);
  const row = await findByNumber(u.db, order.number);
  await announceOrder(u, row);
  const view = await orderBody(u.db, row, now);
  return { status: 201, body: view };
}
