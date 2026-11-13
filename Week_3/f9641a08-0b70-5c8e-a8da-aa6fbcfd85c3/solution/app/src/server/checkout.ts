import type { AddressFields, Checkout, CheckoutStep, Hold, ShippingMethod } from "../shared/api";
import type { Session } from "./auth";
import { cartRows, giftBalanceFor, lineBody, priced, type CartRow } from "./cart";
import { checkDiscount } from "./codes";
import { config } from "./config";
import { emit, one, rows, unit, type Queryable, type Unit } from "./db";
import { ApiError, FIELD, fail, outOfStock, validation } from "./errors";
import { announceStock, figures, holdable, lapseExpiredHolds, lockVariants, move, takeFrom, totalAvailable, variantName } from "./stock";
import { compute, type DiscountRule } from "./totals";
import { checkAddress, checkEmail, checkPhone, type Fields } from "./validate";

const STEPS: CheckoutStep[] = ["contact", "delivery", "shipping", "payment"];

interface CheckoutRow {
  id: string;
  user_id: string;
  step: CheckoutStep;
  contact: { email: string; phone: string } | null;
  delivery: { address_id: string | null; address: AddressFields } | null;
  gift: boolean;
  gift_message: string;
  gift_card_shown: number | null;
  reserved_at: Date | null;
  placed_order_id: string | null;
}

const COLUMNS = "id, user_id, step, contact, delivery, gift, gift_message, gift_card_shown, reserved_at, placed_order_id";

/** The checkout when it belongs to the signed-in customer; anyone else's answers like an unknown id. */
export async function loadOwned(db: Queryable, id: string, userId: string, lock = false): Promise<CheckoutRow> {
  const row = /^[0-9a-f-]{36}$/.test(id) ? await one<CheckoutRow>(db, `SELECT ${COLUMNS} FROM checkouts WHERE id = $1 AND user_id = $2 ${lock ? "FOR UPDATE" : ""}`, [id, userId]) : null;
  if (!row) throw fail("not_found");
  return row;
}

export async function holdOf(db: Queryable, row: CheckoutRow, now: Date): Promise<Hold> {
  if (row.placed_order_id || !row.reserved_at) return { status: "none", expires_at: null, seconds_left: 0 };
  const expires = new Date(row.reserved_at.getTime() + config.reservationTtlSeconds * 1000);
  const active = await one(db, "SELECT 1 FROM hold_chunks WHERE checkout_id = $1 AND state = 'active' LIMIT 1", [row.id]);
  if (active && now < expires) return { status: "active", expires_at: expires.toISOString(), seconds_left: Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / 1000)) };
  return { status: "expired", expires_at: expires.toISOString(), seconds_left: 0 };
}

interface LineRow extends Omit<CartRow, "price" | "available"> {
  live_price: number;
  unit_price: number | null;
}

/** The checkout's lines; priced at the live price until the hold is placed, then at the price fixed with it. */
export async function checkoutLines(db: Queryable, id: string): Promise<CartRow[]> {
  const found = await rows<LineRow>(
    db,
    `SELECT l.id, l.sku, l.quantity, l.unit_price, p.name AS product_name, v.colour, v.size_slug, p.category, v.price AS live_price
     FROM checkout_lines l JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id
     WHERE l.checkout_id = $1 ORDER BY l.position`,
    [id],
  );
  const stock = await figures(db, found.map((l) => l.sku));
  return found.map((l) => ({
    id: l.id,
    sku: l.sku,
    quantity: l.quantity,
    product_name: l.product_name,
    colour: l.colour,
    size_slug: l.size_slug,
    category: l.category,
    price: l.unit_price ?? l.live_price,
    available: totalAvailable(stock.get(l.sku) ?? { bhiwandi: ZERO, gurugram: ZERO }),
  }));
}
const ZERO = { available: 0, reserved: 0, committed: 0, dispatched: 0 };

interface CartSettings {
  shipping_method: ShippingMethod;
  discount_code: string | null;
  gift_card_code: string | null;
}

export async function settingsOf(db: Queryable, owner: string): Promise<CartSettings> {
  return (await one<CartSettings>(db, "SELECT shipping_method, discount_code, gift_card_code FROM carts WHERE owner = $1", [owner])) ?? { shipping_method: "standard", discount_code: null, gift_card_code: null };
}

/** The discount that still applies to these lines, or null. */
async function liveRule(db: Queryable, code: string | null, lines: CartRow[], now: Date): Promise<DiscountRule | null> {
  if (!code) return null;
  try {
    return await checkDiscount(db, code, priced(lines), now);
  } catch {
    return null;
  }
}

export async function body(u: Unit, row: CheckoutRow, owner: string, now: Date): Promise<Checkout> {
  const lines = await checkoutLines(u.db, row.id);
  const settings = await settingsOf(u.db, owner);
  const rule = await liveRule(u.db, settings.discount_code, lines, now);
  const balance = await giftBalanceFor(u.db, settings.gift_card_code, true);
  const result = compute(priced(lines), rule, settings.shipping_method, balance);
  const shown = settings.gift_card_code ? result.totals.gift_card : null;
  if (shown !== row.gift_card_shown) await u.db.query("UPDATE checkouts SET gift_card_shown = $2 WHERE id = $1", [row.id, shown]);
  const byId = new Map(result.lines.map((a) => [a.id, a]));
  return {
    id: row.id,
    step: row.step,
    contact: row.contact,
    delivery: row.delivery,
    shipping_method: settings.shipping_method,
    gift: row.gift,
    gift_message: row.gift_message,
    lines: lines.map((l) => lineBody(l, byId.get(l.id) ?? { subtotal: 0, discount: 0 })),
    totals: result.totals,
    discount: rule && settings.discount_code ? { code: settings.discount_code, kind: rule.kind, value: rule.value } : null,
    gift_card: settings.gift_card_code ? { last4: settings.gift_card_code.slice(-4), balance } : null,
    hold: await holdOf(u.db, row, now),
    server_time: now.toISOString(),
    order_number: row.placed_order_id ? ((await one<{ number: string }>(u.db, "SELECT number FROM orders WHERE id = $1", [row.placed_order_id]))?.number ?? null) : null,
  };
}

export async function create(u: Unit, session: Session, userId: string, now: Date): Promise<Checkout> {
  const lines = await cartRows(u.db, session.owner);
  if (lines.length === 0) throw validation({ cart: FIELD.cart });
  const { rows: [created] } = await u.db.query<{ id: string }>("INSERT INTO checkouts (user_id) VALUES ($1) RETURNING id", [userId]);
  if (!created) throw new Error("checkout inserted");
  for (const line of lines) await u.db.query("INSERT INTO checkout_lines (checkout_id, sku, quantity) VALUES ($1, $2, $3)", [created.id, line.sku, line.quantity]);
  return body(u, await loadOwned(u.db, created.id, userId), session.owner, now);
}

function nextStep(step: CheckoutStep): CheckoutStep {
  return STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)] ?? "payment";
}

export async function patch(u: Unit, session: Session, userId: string, id: string, input: Record<string, unknown>, now: Date): Promise<Checkout> {
  let row = await loadOwned(u.db, id, userId, true);
  if (row.placed_order_id) throw fail("invalid_transition");
  const step = STEPS.find((s) => s === input.step);
  if (!step) throw validation({ step: FIELD.step });
  if (input.go === true) {
    if (STEPS.indexOf(step) > STEPS.indexOf(row.step)) throw fail("invalid_transition");
    await u.db.query("UPDATE checkouts SET step = $2 WHERE id = $1", [id, step]);
  } else {
    const fields: Fields = {};
    if (step === "contact") {
      const email = checkEmail(input.email, fields);
      const phone = checkPhone(input.phone, fields);
      if (Object.keys(fields).length > 0) throw validation(fields);
      await u.db.query("UPDATE checkouts SET contact = $2, step = $3 WHERE id = $1", [id, JSON.stringify({ email, phone }), nextStep(step)]);
    } else if (step === "delivery") {
      let delivery: { address_id: string | null; address: AddressFields };
      if (typeof input.address_id === "string") {
        const saved = /^[0-9a-f-]{36}$/.test(input.address_id)
          ? await one<AddressFields>(u.db, "SELECT name, line1, line2, city, state, postcode, phone FROM addresses WHERE id = $1 AND user_id = $2", [input.address_id, userId])
          : null;
        if (!saved) throw fail("not_found");
        delivery = { address_id: input.address_id, address: saved };
      } else {
        const address = checkAddress(input.address, fields, "address");
        if (Object.keys(fields).length > 0) throw validation(fields);
        delivery = { address_id: null, address };
      }
      await u.db.query("UPDATE checkouts SET delivery = $2, step = $3 WHERE id = $1", [id, JSON.stringify(delivery), nextStep(step)]);
    } else if (step === "shipping") {
      const method = input.method === "standard" || input.method === "express" ? input.method : null;
      const message = typeof input.gift_message === "string" ? input.gift_message : "";
      if (!method) fields.method = FIELD.method;
      if (message.length > 200) fields.gift_message = FIELD.giftMessage;
      if (Object.keys(fields).length > 0) throw validation(fields);
      const gift = input.gift === true;
      await u.db.query("UPDATE carts SET shipping_method = $2 WHERE owner = $1", [session.owner, method]);
      await u.db.query("UPDATE checkouts SET gift = $2, gift_message = $3, step = $4 WHERE id = $1", [id, gift, gift ? message : "", nextStep(step)]);
    } else {
      throw fail("invalid_transition");
    }
  }
  row = await loadOwned(u.db, id, userId);
  return body(u, row, session.owner, now);
}

/** Holds every line, all or none: from the location with the most available, ties to bhiwandi. */
export async function reserveHold(session: Session, userId: string, id: string): Promise<Hold> {
  await lapseExpiredHolds();
  try {
    return await unit(async (u) => {
      const row = await loadOwned(u.db, id, userId, true);
      if (row.placed_order_id) throw fail("invalid_transition");
      const now = new Date();
      const current = await holdOf(u.db, row, now);
      if (current.status === "active") return current;
      const lines = await rows<{ id: string; sku: string; quantity: number }>(u.db, "SELECT id, sku, quantity FROM checkout_lines WHERE checkout_id = $1 ORDER BY position", [id]);
      await lockVariants(u.db, lines.map((l) => l.sku));
      const stock = await figures(u.db, lines.map((l) => l.sku));
      for (const line of lines) {
        const available = holdable(stock.get(line.sku) ?? { bhiwandi: ZERO, gurugram: ZERO });
        if (available < line.quantity) throw outOfStock(await variantName(u.db, line.sku), line.sku, available);
      }
      for (const line of lines) {
        const by = stock.get(line.sku);
        if (!by) continue;
        const chunk = takeFrom(by, line.quantity);
        await move(u.db, { sku: line.sku, location: chunk.location, reason: "hold_placed", ref: `checkout:${id}`, from: "available", to: "reserved", quantity: chunk.quantity, at: now });
        await u.db.query("INSERT INTO hold_chunks (checkout_id, sku, location, quantity) VALUES ($1, $2, $3, $4)", [id, line.sku, chunk.location, chunk.quantity]);
        by[chunk.location].available -= chunk.quantity;
        await u.db.query("UPDATE checkout_lines SET unit_price = (SELECT price FROM variants WHERE sku = $2) WHERE id = $1", [line.id, line.sku]);
      }
      await u.db.query("UPDATE checkouts SET reserved_at = $2 WHERE id = $1", [id, now]);
      await announceStock(u, lines.map((l) => l.sku));
      return holdOf(u.db, { ...row, reserved_at: now }, now);
    });
  } catch (failure) {
    if (failure instanceof ApiError && failure.body.error === "out_of_stock") await clampAfterRefusal(session, id);
    throw failure;
  }
}

/** "We updated your bag": a refused hold trims the bag and the checkout to what is left. */
async function clampAfterRefusal(session: Session, id: string): Promise<void> {
  await unit(async (u) => {
    const lines = await rows<{ sku: string }>(u.db, "SELECT sku FROM checkout_lines WHERE checkout_id = $1", [id]);
    await lockVariants(u.db, lines.map((l) => l.sku));
    const stock = await figures(u.db, lines.map((l) => l.sku));
    for (const { sku } of lines) {
      const available = totalAvailable(stock.get(sku) ?? { bhiwandi: ZERO, gurugram: ZERO });
      if (available <= 0) continue;
      await u.db.query("UPDATE checkout_lines SET quantity = least(quantity, $2) WHERE checkout_id = $1 AND sku = $3", [id, available, sku]);
      await u.db.query("UPDATE cart_lines SET quantity = least(quantity, $2) WHERE owner = $1 AND sku = $3", [session.owner, available, sku]);
    }
    const count = await one<{ n: number }>(u.db, "SELECT coalesce(sum(quantity), 0) AS n FROM cart_lines WHERE owner = $1", [session.owner]);
    emit(u, "cart", { count: count?.n ?? 0 }, "owner", session.owner);
  });
}
