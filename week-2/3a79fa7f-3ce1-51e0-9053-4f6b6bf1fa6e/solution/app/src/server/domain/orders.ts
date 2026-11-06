// Orders (brief: Checkout and orders): idempotent, all-or-nothing placement, lifecycle and cancellation.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { loadCatalog } from "../catalog.ts";
import { nextCounter, pool, transaction, type Db, type Tx } from "../db.ts";
import { ApiError, assertValid, refuseUnknown, unknownFields, type Fields } from "../errors.ts";
import { iso, now } from "../clock.ts";
import { adjustToZero, billingKey, billingRefusal, BillingUnavailable, charge, ensureAccount, type ChargeItem, type Invoice } from "../killbill.ts";
import type { AuthedCtx, User } from "../http.ts";
import { accountCartId, cartState } from "./cart.ts";
import { availableCredits, computeBreakdown, flagFields, flagsOf, type Breakdown } from "./checkout.ts";
import { PHONE } from "../patterns.ts";
import { orderConfirmed } from "./notices.ts";

type OrderStatus = "placed" | "shipped" | "delivered" | "cancelled";

/** The order state transition table. */
const ORDER_TRANSITIONS = {
  ship: { from: "placed", to: "shipped" },
  deliver: { from: "shipped", to: "delivered" },
  cancel: { from: "placed", to: "cancelled" },
} as const satisfies Record<string, { from: OrderStatus; to: OrderStatus }>;
type OrderAction = keyof typeof ORDER_TRANSITIONS;

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const ORDER_KEYS = ["country", "address", "use_trade_in", "use_demo_credit"];
const ADDRESS_RULES = {
  name: { min: 2, max: 80, message: "Enter your full name." },
  line1: { min: 3, max: 120, message: "Enter your address." },
  city: { min: 2, max: 60, message: "Enter your city." },
  postal_code: { min: 2, max: 12, message: "Enter your postal code." },
} as const;
type Address = Record<keyof typeof ADDRESS_RULES | "phone", string>;

export interface OrderLine {
  id: number;
  type: "build" | "accessory";
  sku: string;
  code: string | null;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
  protected_until: string | null;
}

export interface Order {
  number: string;
  status: OrderStatus;
  placed_at: string;
  country: string;
  address: Address;
  lines: OrderLine[];
  subtotal_cents: number;
  discounts: Breakdown["discounts"];
  credits: Breakdown["credits"];
  taxable_cents: number;
  shipping_cents: number;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: Breakdown["taxes"];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  trade_in_id: number | null;
  billing_account_key: string;
  billing_invoice_id: string | null;
  events: { status: OrderStatus; at: string; by: string }[];
}

function parseAddress(body: Record<string, unknown>): Address {
  const unknown = refuseUnknown(body, ORDER_KEYS);
  const address = body.address;
  const isObject = typeof address === "object" && address !== null && !Array.isArray(address);
  if (isObject) Object.assign(unknown, refuseUnknown(address as Record<string, unknown>, [...Object.keys(ADDRESS_RULES), "phone"], "address."));
  if (Object.keys(unknown).length) throw unknownFields(unknown);
  const given = (isObject ? address : {}) as Record<string, unknown>;
  const fields: Fields = {};
  for (const [key, rule] of Object.entries(ADDRESS_RULES)) {
    const value = given[key];
    const length = typeof value === "string" ? value.trim().length : -1;
    if (length < rule.min || length > rule.max) fields[`address.${key}`] = rule.message;
  }
  if (typeof given.phone !== "string" || !PHONE.pattern.test(given.phone)) fields["address.phone"] = PHONE.message;
  for (const [key, message] of Object.entries(flagFields(body, given.postal_code, "address.postal_code"))) fields[key] ??= message;
  assertValid(fields);
  return Object.fromEntries([...Object.keys(ADDRESS_RULES), "phone"].map((k) => [k, (given[k] as string).trim()])) as Address;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

interface OrderRow {
  number: string;
  status: OrderStatus;
  placed_at: Date;
  country: string;
  address: Address;
  subtotal_cents: number;
  discounts: Breakdown["discounts"];
  credits: Breakdown["credits"];
  taxable_cents: number;
  shipping_cents: number;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: Breakdown["taxes"];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  trade_in_id: number | null;
  billing_account_key: string;
  billing_account_id: string | null;
  billing_invoice_id: string | null;
  billing_items: Invoice["items"];
  user_id: number;
  demo_credit_used: boolean;
}

async function orderRow(db: Db, number: string, lock = false): Promise<OrderRow | undefined> {
  const { rows } = await db.query<OrderRow>(`SELECT * FROM orders WHERE number = $1${lock ? " FOR UPDATE" : ""}`, [number]);
  return rows[0];
}

async function present(db: Db, row: OrderRow): Promise<Order> {
  const lines = await db.query<Omit<OrderLine, "protected_until"> & { protected_until: Date | null }>(
    `SELECT l.id, l.type, l.sku, l.build_code AS code, l.name, l.quantity, l.unit_cents, l.line_cents,
            CASE WHEN p.voided THEN NULL ELSE p.protected_until END AS protected_until
     FROM order_lines l LEFT JOIN protection_plans p ON p.line_id = l.id WHERE l.order_number = $1 ORDER BY l.position`,
    [row.number],
  );
  const events = await db.query<{ status: OrderStatus; at: Date; by_email: string }>(
    "SELECT status, at, by_email FROM order_events WHERE order_number = $1 ORDER BY id",
    [row.number],
  );
  return {
    number: row.number,
    status: row.status,
    placed_at: iso(row.placed_at),
    country: row.country,
    address: { name: row.address.name, line1: row.address.line1, city: row.address.city, postal_code: row.address.postal_code, phone: row.address.phone },
    lines: lines.rows.map((l) => ({
      id: l.id,
      type: l.type,
      sku: l.sku,
      code: l.code,
      name: l.name,
      quantity: l.quantity,
      unit_cents: l.unit_cents,
      line_cents: l.line_cents,
      protected_until: l.protected_until ? iso(l.protected_until) : null,
    })),
    subtotal_cents: row.subtotal_cents,
    discounts: row.discounts.map(({ code, amount_cents }) => ({ code, amount_cents })),
    credits: row.credits.map(({ kind, amount_cents }) => ({ kind, amount_cents })),
    taxable_cents: row.taxable_cents,
    shipping_cents: row.shipping_cents,
    packed_batteries: row.packed_batteries,
    standalone_batteries: row.standalone_batteries,
    dangerous_goods_cents: row.dangerous_goods_cents,
    taxes: row.taxes.map(({ name, rate_pcm, amount_cents }) => ({ name, rate_pcm, amount_cents })),
    tax_cents: row.tax_cents,
    total_cents: row.total_cents,
    ships_on: row.ships_on,
    arrives_on: row.arrives_on,
    trade_in_id: row.trade_in_id,
    billing_account_key: row.billing_account_key,
    billing_invoice_id: row.billing_invoice_id,
    events: events.rows.map((e) => ({ status: e.status, at: iso(e.at), by: e.by_email })),
  };
}

/** An order the user owns, or 404. */
export async function ownOrder(db: Db, user: User, number: string, lock = false): Promise<OrderRow> {
  const row = await orderRow(db, number, lock);
  if (!row || row.user_id !== user.id) throw new ApiError("not_found");
  return row;
}

export async function readOrder(db: Db, user: User, number: string): Promise<Order> {
  return present(db, await ownOrder(db, user, number));
}

const PAGE = { min: 1, max: 50, default: 20 } as const;
let cursorSecret: Buffer | null = null;

async function cursorKey(db: Db): Promise<Buffer> {
  if (!cursorSecret) {
    const { rows } = await db.query<{ value: string }>("SELECT value FROM settings WHERE name = 'cursor_key'");
    cursorSecret = Buffer.from(rows[0]!.value, "hex");
  }
  return cursorSecret;
}

function cursorMac(key: Buffer, number: string): string {
  return createHmac("sha256", key).update(number).digest("base64url").slice(0, 22);
}

/** The opaque cursor after `number`: the number and its MAC, so an altered or foreign cursor is refused. */
async function issueCursor(db: Db, number: string): Promise<string> {
  return Buffer.from(`${number}.${cursorMac(await cursorKey(db), number)}`).toString("base64url");
}

async function readCursor(db: Db, cursor: string): Promise<string | null> {
  const [number = "", mac = ""] = Buffer.from(cursor, "base64url").toString().split(".");
  const want = Buffer.from(cursorMac(await cursorKey(db), number));
  const got = Buffer.from(mac);
  return /^TF-\d{6}$/.test(number) && got.length === want.length && timingSafeEqual(got, want) ? number : null;
}

/** One page of orders, newest number first, after the cursor; `userId` null lists every customer's orders. */
export async function listOrders(db: Db, userId: number | null, query: URLSearchParams): Promise<{ orders: Order[]; next_cursor: string | null }> {
  const fields: Fields = {};
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? PAGE.default : /^\d{1,2}$/.test(rawLimit) ? Number(rawLimit) : 0;
  if (limit < PAGE.min || limit > PAGE.max) fields.limit = "Choose 1 to 50.";
  const rawCursor = query.get("cursor");
  const after = rawCursor === null ? null : await readCursor(db, rawCursor);
  if (rawCursor !== null && after === null) fields.cursor = "This page link is invalid.";
  assertValid(fields);
  const where: string[] = [];
  const params: unknown[] = [];
  if (userId !== null) where.push(`user_id = $${params.push(userId)}`);
  if (after !== null) where.push(`number < $${params.push(after)}`);
  const { rows } = await db.query<OrderRow>(
    `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY number DESC LIMIT $${params.push(limit + 1)}`,
    params,
  );
  const page = rows.slice(0, limit);
  const orders = await Promise.all(page.map((row) => present(db, row)));
  return { orders, next_cursor: rows.length > limit ? await issueCursor(db, page[page.length - 1]!.number) : null };
}

async function addEvent(tx: Tx, number: string, status: OrderStatus, by: string): Promise<void> {
  await tx.query("INSERT INTO order_events (order_number, status, at, by_email) VALUES ($1, $2, $3, $4)", [number, status, now(), by]);
}

/** The invoice items of Kill Bill, one per non-zero total component, in the published order. */
function invoiceItems(number: string, b: Breakdown): ChargeItem[] {
  const items: ChargeItem[] = [
    { description: `${number} merchandise`, cents: b.taxable_cents },
    { description: `${number} shipping`, cents: b.shipping_cents },
    { description: `${number} dangerous goods`, cents: b.dangerous_goods_cents },
    { description: `${number} tax`, cents: b.tax_cents },
  ];
  return items.filter((i) => i.cents !== 0);
}

function moveTo(row: OrderRow, action: OrderAction): OrderStatus {
  const step = ORDER_TRANSITIONS[action];
  if (row.status !== step.from) throw new ApiError("illegal_transition", { message: "This order cannot be changed now." });
  return step.to;
}

/** POST /api/orders. Claims the key, places the order in one transaction, or releases the key on refusal. */
export async function placeOrder(ctx: AuthedCtx): Promise<{ status: number; order: Order }> {
  const key = ctx.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) throw new ApiError("idempotency_key_required");
  const fingerprint = createHash("sha256").update(canonical(ctx.body)).digest("hex");
  for (;;) {
    const claimed = await pool.query(
      `INSERT INTO idempotency_keys (user_id, key, fingerprint, status, created_at) VALUES ($1, $2, $3, 'in_progress', $4)
       ON CONFLICT (user_id, key) DO NOTHING`,
      [ctx.user.id, key, fingerprint, now()],
    );
    if (claimed.rowCount === 1) break;
    const { rows } = await pool.query<{ fingerprint: string; status: string; order_number: string | null }>(
      "SELECT fingerprint, status, order_number FROM idempotency_keys WHERE user_id = $1 AND key = $2",
      [ctx.user.id, key],
    );
    const stored = rows[0];
    if (!stored) continue;
    if (stored.status === "in_progress") throw new ApiError("idempotency_in_progress");
    if (stored.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
    return { status: 200, order: await readOrder(pool, ctx.user, stored.order_number as string) };
  }
  try {
    const number = await place(ctx, key);
    return { status: 201, order: await readOrder(pool, ctx.user, number) };
  } catch (error) {
    await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [ctx.user.id, key]);
    throw error;
  }
}

async function place(ctx: AuthedCtx, key: string): Promise<string> {
  const address = parseAddress(ctx.body);
  const flags = flagsOf(ctx.body, address.postal_code);
  const user = ctx.user;
  let charged: { account: string; invoice: Invoice; number: string } | null = null;
  const reverseCharge = async () => {
    if (!charged) return;
    const { account, invoice, number } = charged;
    await adjustToZero(account, invoice, { reason: "order_placed", number })
      .catch((e: unknown) => console.error("could not reverse the Kill Bill charge of", number, e));
  };
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    const cartId = await accountCartId(tx, user.id);
    const catalog = await loadCatalog(tx);
    const state = await cartState(tx, cartId, catalog);
    const credits = await availableCredits(tx, user.id);
    const placedAt = now();
    const breakdown = computeBreakdown(state.lines, state.cart.codes, flags, credits, placedAt);
    const take = new Map<string, number>();
    for (const line of state.lines) take.set(line.sku, (take.get(line.sku) ?? 0) + line.quantity);
    for (const sku of [...take.keys()].sort()) {
      const taken = await tx.query("UPDATE products SET stock = stock - $2 WHERE sku = $1 AND stock >= $2", [sku, take.get(sku)]);
      if (taken.rowCount !== 1) throw new ApiError("out_of_stock", { message: `${sku} is out of stock.` });
    }
    const usesTradeIn = breakdown.credits.some((c) => c.kind === "trade_in");
    const usesDemo = breakdown.credits.some((c) => c.kind === "demo");
    const number = `TF-${await nextCounter(tx, "order")}`;
    const spent = [
      usesTradeIn ? await tx.query("UPDATE trade_ins SET status = 'applied', order_number = $2 WHERE id = $1 AND status = 'accepted'", [credits.tradeIn?.id, number]) : null,
      usesDemo ? await tx.query("UPDATE demo_credits SET used_order_number = $2 WHERE user_id = $1 AND used_order_number IS NULL AND expires_at > $3", [user.id, number, placedAt]) : null,
    ];
    if (spent.some((r) => r && r.rowCount !== 1)) throw new ApiError("credit_unavailable");
    const items = invoiceItems(number, breakdown);
    let account: string | null = null;
    let invoice: Invoice | null = null;
    try {
      account = await ensureAccount({ email: user.email, name: address.name, country: flags.country, number });
      if (items.length) invoice = await charge(account, number, items);
    } catch (error) {
      if (error instanceof BillingUnavailable) throw billingRefusal("placement");
      throw error;
    }
    if (invoice) charged = { account, invoice, number };
    await tx.query(
      `INSERT INTO orders (number, user_id, status, placed_at, country, address, subtotal_cents, discounts, credits, taxable_cents,
         shipping_cents, packed_batteries, standalone_batteries, dangerous_goods_cents, taxes, tax_cents, total_cents, ships_on, arrives_on,
         trade_in_id, demo_credit_used, billing_account_key, billing_account_id, billing_invoice_id, billing_items)
       VALUES ($1, $2, 'placed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
      [number, user.id, placedAt, flags.country, JSON.stringify(address), breakdown.subtotal_cents, JSON.stringify(breakdown.discounts),
        JSON.stringify(breakdown.credits), breakdown.taxable_cents, breakdown.shipping_cents, breakdown.packed_batteries,
        breakdown.standalone_batteries, breakdown.dangerous_goods_cents, JSON.stringify(breakdown.taxes), breakdown.tax_cents,
        breakdown.total_cents, breakdown.ships_on, breakdown.arrives_on, usesTradeIn ? credits.tradeIn?.id : null, usesDemo,
        billingKey(user.email), account, invoice?.invoiceId ?? null, JSON.stringify(invoice?.items ?? [])],
    );
    for (const [position, line] of state.lines.entries()) {
      await tx.query(
        `INSERT INTO order_lines (order_number, position, type, sku, build_code, name, quantity, unit_cents, line_cents, spares)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [number, position, line.type, line.sku, line.code, line.name, line.quantity, line.unit_cents, line.line_cents, line.spares],
      );
    }
    await addEvent(tx, number, "placed", user.email);
    await tx.query("DELETE FROM cart_lines WHERE cart_id = $1", [cartId]);
    await tx.query("DELETE FROM cart_codes WHERE cart_id = $1", [cartId]);
    await tx.query("UPDATE idempotency_keys SET status = 'done', order_number = $3 WHERE user_id = $1 AND key = $2", [user.id, key, number]);
    await orderConfirmed(tx, user.email, { number, ...breakdown });
    return number;
  }, reverseCharge);
}

/** Owner cancellation: Kill Bill adjusted to zero first, then stock, credits and plans restored in one transaction. */
export async function cancelOrder(user: User, number: string): Promise<Order> {
  return transaction(async (tx) => {
    const row = await ownOrder(tx, user, number, true);
    const status = moveTo(row, "cancel");
    try {
      if (row.billing_account_id && row.billing_invoice_id) {
        await adjustToZero(row.billing_account_id, { invoiceId: row.billing_invoice_id, items: row.billing_items }, { reason: "order_cancelled", number });
      }
    } catch (error) {
      if (error instanceof BillingUnavailable) throw billingRefusal("cancellation");
      throw error;
    }
    const { rows } = await tx.query<{ sku: string; quantity: number }>(
      "SELECT sku, sum(quantity)::int AS quantity FROM order_lines WHERE order_number = $1 GROUP BY sku ORDER BY sku",
      [number],
    );
    for (const line of rows) await tx.query("UPDATE products SET stock = stock + $2 WHERE sku = $1", [line.sku, line.quantity]);
    if (row.demo_credit_used) await tx.query("UPDATE demo_credits SET used_order_number = NULL WHERE user_id = $1", [user.id]);
    if (row.trade_in_id !== null) await tx.query("UPDATE trade_ins SET status = 'accepted', order_number = NULL WHERE id = $1", [row.trade_in_id]);
    await tx.query("UPDATE protection_plans SET voided = true WHERE order_number = $1", [number]);
    await tx.query("UPDATE orders SET status = $2 WHERE number = $1", [number, status]);
    await addEvent(tx, number, status, user.email);
    return present(tx, { ...row, status });
  });
}

/** Admin shipping and delivery. */
export async function advanceOrder(admin: User, number: string, action: "ship" | "deliver"): Promise<Order> {
  return transaction(async (tx) => {
    const row = await orderRow(tx, number, true);
    if (!row) throw new ApiError("not_found");
    const status = moveTo(row, action);
    await tx.query("UPDATE orders SET status = $2 WHERE number = $1", [number, status]);
    await addEvent(tx, number, status, admin.email);
    return present(tx, { ...row, status });
  });
}

export async function orderForTracking(db: Db, number: string): Promise<{ row: OrderRow; email: string } | null> {
  const { rows } = await db.query<OrderRow & { email: string }>(
    "SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.number = $1",
    [number],
  );
  const row = rows[0];
  return row ? { row, email: row.email } : null;
}

export async function trackingView(db: Db, row: OrderRow): Promise<{ number: string; status: OrderStatus; events: { status: OrderStatus; at: string }[]; lines: string[] }> {
  const order = await present(db, row);
  return { number: order.number, status: order.status, events: order.events.map(({ status, at }) => ({ status, at })), lines: order.lines.map((l) => l.name) };
}
