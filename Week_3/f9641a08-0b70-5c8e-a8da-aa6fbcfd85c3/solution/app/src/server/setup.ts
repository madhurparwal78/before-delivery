import { timingSafeEqual } from "node:crypto";
import { SIZE_LABELS, slugify } from "../shared/format";
import type { AddressFields, Fulfillment, OrderStatus } from "../shared/api";
import { hashPassword, newSessionId } from "./auth";
import { findDiscount } from "./codes";
import { config } from "./config";
import { one, rows, unit, type Unit } from "./db";
import { FIELD, validation } from "./errors";
import * as giftcards from "./giftcards";
import { announceStock, figures, holdable, move, takeFrom, type Account } from "./stock";
import { compute, type DiscountRule } from "./totals";
import { insertOrder } from "./orders";
import { warrantyEnd } from "./windows";
import { CASE_NUMBER_PREFIX } from "./machines";
import type { CaseKind } from "../shared/api";

// POST /api/grading/setup: adds records on top of the seed data. It exists only when GRADING_TOKEN is set.

type Body = Record<string, unknown>;

export function tokenMatches(given: string | undefined): boolean {
  if (!config.gradingToken || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(config.gradingToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

class Plan {
  readonly fields: Record<string, string> = {};
  readonly ids: Record<string, string> = {};
  readonly sessions: Record<string, string> = {};
  readonly users = new Map<string, { id: string; email: string; name: string }>();
  readonly addresses = new Map<string, { id: string; phone: string; value: AddressFields }>();
  readonly lines = new Map<string, { id: string; orderId: string; sku: string; deliveredAt: Date | null; category: string }>();
  readonly registrations = new Map<string, { id: string }>();
  readonly touched = new Set<string>();

  bad(path: string): void {
    this.fields[path] = FIELD.setup;
  }

  list(body: Body, section: string): Body[] {
    const value = body[section];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.bad(section);
      return [];
    }
    return value.map((item) => (typeof item === "object" && item !== null ? (item as Body) : {}));
  }

  text(item: Body, path: string, name: string, optional = false): string {
    const value = item[name];
    if (typeof value === "string" && (value !== "" || optional)) return value;
    if (!(optional && (value === undefined || value === null))) this.bad(`${path}.${name}`);
    return "";
  }

  whole(item: Body, path: string, name: string, min = 0): number {
    const value = item[name];
    if (typeof value === "number" && Number.isInteger(value) && value >= min) return value;
    this.bad(`${path}.${name}`);
    return min;
  }

  date(item: Body, path: string, name: string): Date {
    const value = item[name];
    const parsed = typeof value === "string" ? new Date(value) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    this.bad(`${path}.${name}`);
    return new Date();
  }
}

const ROLES = ["customer", "operations", "support"];
const CATEGORIES = ["luggage", "backpacks", "totes", "wallets", "accessories"];

async function users(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "users").entries()) {
    const path = `users.${i}`;
    const key = plan.text(item, path, "key");
    const name = plan.text(item, path, "name");
    const email = plan.text(item, path, "email");
    const password = plan.text(item, path, "password");
    const role = typeof item.role === "string" && ROLES.includes(item.role) ? item.role : (plan.bad(`${path}.role`), "customer");
    if (Object.keys(plan.fields).length > 0) continue;
    if (await one(u.db, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [email])) {
      plan.bad(`${path}.email`);
      continue;
    }
    const { rows: [created] } = await u.db.query<{ id: string }>("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id", [name, email, await hashPassword(password), role]);
    if (!created) throw new Error("user inserted");
    const session = newSessionId();
    await u.db.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [session, created.id]);
    plan.users.set(key, { id: created.id, email, name });
    plan.ids[key] = created.id;
    plan.sessions[key] = session;
  }
}

async function addresses(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "addresses").entries()) {
    const path = `addresses.${i}`;
    const owner = plan.users.get(plan.text(item, path, "user"));
    if (!owner) plan.bad(`${path}.user`);
    const value = Object.fromEntries(["label", "name", "line1", "city", "state", "postcode", "phone"].map((k) => [k, plan.text(item, path, k)]));
    const line2 = plan.text(item, path, "line2", true);
    if (!owner || Object.keys(plan.fields).length > 0) continue;
    const { rows: [created] } = await u.db.query<{ id: string }>(
      "INSERT INTO addresses (user_id, label, name, line1, line2, city, state, postcode, phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [owner.id, value.label, value.name, value.line1, line2, value.city, value.state, value.postcode, value.phone],
    );
    if (!created) throw new Error("address inserted");
    plan.addresses.set(plan.text(item, path, "key"), { id: created.id, phone: value.phone ?? "", value: { name: value.name ?? "", line1: value.line1 ?? "", line2, city: value.city ?? "", state: value.state ?? "", postcode: value.postcode ?? "", phone: value.phone ?? "" } });
    plan.ids[plan.text(item, path, "key")] = created.id;
  }
}

async function setAvailable(u: Unit, sku: string, location: "bhiwandi" | "gurugram", target: number, plan: Plan): Promise<void> {
  const current = (await figures(u.db, [sku])).get(sku)?.[location].available ?? 0;
  if (target === current) return;
  const up = target > current;
  await move(u.db, { sku, location, reason: up ? "stock_received" : "stock_adjusted", ref: "setup", from: up ? "external" : "available", to: up ? "available" : "external", quantity: Math.abs(target - current), at: new Date() });
  plan.touched.add(sku);
}

async function products(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "products").entries()) {
    const path = `products.${i}`;
    const key = plan.text(item, path, "key");
    const slug = plan.text(item, path, "slug");
    const name = plan.text(item, path, "name");
    const material = plan.text(item, path, "material");
    const category = typeof item.category === "string" && CATEGORIES.includes(item.category) ? item.category : (plan.bad(`${path}.category`), "luggage");
    const status = item.status === "draft" || item.status === "published" || item.status === "archived" ? item.status : (plan.bad(`${path}.status`), "draft");
    const variants = Array.isArray(item.variants) && item.variants.length > 0 ? (item.variants as Body[]) : (plan.bad(`${path}.variants`), []);
    const parsed = variants.map((v, j) => {
      const p = `${path}.variants.${j}`;
      const size = typeof v.size === "string" && v.size in SIZE_LABELS ? v.size : (plan.bad(`${p}.size`), "one-size");
      const number = (n: string): number => (typeof v[n] === "number" && (v[n] as number) > 0 ? (v[n] as number) : (plan.bad(`${p}.${n}`), 1));
      const compare = v.compare_at === null || v.compare_at === undefined ? null : plan.whole(v, p, "compare_at", 1);
      return { sku: plan.text(v, p, "sku"), colour: plan.text(v, p, "colour"), size, h: number("height_cm"), w: number("width_cm"), d: number("depth_cm"), kg: number("weight_kg"), price: plan.whole(v, p, "price", 1), compare, available: plan.whole(v, p, "available", 0) };
    });
    if (Object.keys(plan.fields).length > 0) continue;
    if (await one(u.db, "SELECT 1 FROM products WHERE slug = $1", [slug])) {
      plan.bad(`${path}.slug`);
      continue;
    }
    const { rows: [created] } = await u.db.query<{ id: string }>(
      "INSERT INTO products (slug, name, category, material, description, status, published_at) VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6 = 'published' THEN now() END) RETURNING id",
      [slug, name, category, material, `${name}, ${material.toLowerCase()} ${category}.`, status],
    );
    if (!created) throw new Error("product inserted");
    for (const [position, v] of parsed.entries()) {
      await u.db.query(
        `INSERT INTO variants (sku, product_id, colour, colour_slug, size_slug, height_cm, width_cm, depth_cm, weight_kg, price, compare_at, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [v.sku, created.id, v.colour, slugify(v.colour), v.size, v.h, v.w, v.d, v.kg, v.price, v.compare, position],
      );
      if (v.available > 0) await setAvailable(u, v.sku, "bhiwandi", v.available, plan);
      plan.touched.add(v.sku);
    }
    plan.ids[key] = slug;
  }
}

async function stock(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "stock").entries()) {
    const path = `stock.${i}`;
    const sku = plan.text(item, path, "sku");
    const location = item.location === "bhiwandi" || item.location === "gurugram" ? item.location : (plan.bad(`${path}.location`), "bhiwandi");
    const available = plan.whole(item, path, "available", 0);
    if (!(await one(u.db, "SELECT 1 FROM variants WHERE sku = $1", [sku]))) plan.bad(`${path}.sku`);
    if (Object.keys(plan.fields).length === 0) await setAvailable(u, sku, location, available, plan);
  }
}

async function codes(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "gift_cards").entries()) {
    const path = `gift_cards.${i}`;
    const code = plan.text(item, path, "code");
    const balance = plan.whole(item, path, "balance", 0);
    if (Object.keys(plan.fields).length === 0) await giftcards.issue(u.db, code, balance, new Date());
  }
  for (const [i, item] of plan.list(body, "discount_codes").entries()) {
    const path = `discount_codes.${i}`;
    const code = plan.text(item, path, "code");
    const kind = item.kind === "percent" || item.kind === "fixed" ? item.kind : (plan.bad(`${path}.kind`), "percent");
    const value = plan.whole(item, path, "value", 1);
    const collection = typeof item.collection === "string" ? item.collection : null;
    const minimum = plan.whole(item, path, "minimum", 0);
    const starts = plan.date(item, path, "starts_at");
    const ends = plan.date(item, path, "ends_at");
    const limit = item.usage_limit === null || item.usage_limit === undefined ? null : plan.whole(item, path, "usage_limit", 1);
    const used = plan.whole(item, path, "used", 0);
    if (Object.keys(plan.fields).length === 0) {
      await u.db.query(
        "INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used_before) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [code, kind, value, collection, minimum, starts, ends, limit, used],
      );
    }
  }
}

async function carts(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "carts").entries()) {
    const path = `carts.${i}`;
    const owner = plan.users.get(plan.text(item, path, "user"));
    if (!owner) plan.bad(`${path}.user`);
    const lines = Array.isArray(item.lines) ? (item.lines as Body[]) : (plan.bad(`${path}.lines`), []);
    const parsed = lines.map((l, j) => ({ sku: plan.text(l, `${path}.lines.${j}`, "sku"), quantity: plan.whole(l, `${path}.lines.${j}`, "quantity", 1) }));
    const discount = typeof item.discount_code === "string" ? item.discount_code : null;
    const gift = typeof item.gift_card === "string" ? item.gift_card : null;
    if (!owner || Object.keys(plan.fields).length > 0) continue;
    const key = `user:${owner.id}`;
    await u.db.query("INSERT INTO carts (owner, discount_code, gift_card_code) VALUES ($1, $2, $3) ON CONFLICT (owner) DO UPDATE SET discount_code = $2, gift_card_code = $3", [key, discount, gift]);
    await u.db.query("DELETE FROM cart_lines WHERE owner = $1", [key]);
    for (const l of parsed) {
      if (!(await one(u.db, "SELECT 1 FROM variants WHERE sku = $1", [l.sku]))) {
        plan.bad(`${path}.lines`);
        continue;
      }
      await u.db.query("INSERT INTO cart_lines (owner, sku, quantity) VALUES ($1, $2, $3)", [key, l.sku, l.quantity]);
    }
  }
}

const REACHED: OrderStatus[] = ["placed", "packed", "shipped", "out_for_delivery", "delivered"];

function timeline(status: OrderStatus, placed: Date, delivered: Date | null): { status: OrderStatus; at: Date }[] {
  if (status === "cancelled") return [{ status: "placed", at: placed }, { status: "cancelled", at: new Date(placed.getTime() + 3600_000) }];
  const path: OrderStatus[] = status === "partially_shipped" ? ["placed", "packed", "partially_shipped"] : REACHED.slice(0, REACHED.indexOf(status) + 1);
  const end = delivered ?? new Date(placed.getTime() + path.length * 3600_000);
  return path.map((s, i) => ({ status: s, at: i === 0 ? placed : s === "delivered" ? end : new Date(placed.getTime() + ((end.getTime() - placed.getTime()) * i) / Math.max(1, path.length - 1)) }));
}

const FULFILLMENTS: Fulfillment[] = ["unfulfilled", "packed", "shipped", "out_for_delivery", "delivered", "cancelled"];
const ORDER_STATUSES: OrderStatus[] = ["placed", "packed", "partially_shipped", "shipped", "out_for_delivery", "delivered", "cancelled"];
const PAYMENTS = ["pending", "authorized", "captured", "failed"] as const;

async function orders(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "orders").entries()) {
    const path = `orders.${i}`;
    const key = plan.text(item, path, "key");
    const owner = plan.users.get(plan.text(item, path, "user"));
    if (!owner) plan.bad(`${path}.user`);
    const address = plan.addresses.get(plan.text(item, path, "address"));
    if (!address) plan.bad(`${path}.address`);
    const status = ORDER_STATUSES.find((s) => s === item.status) ?? (plan.bad(`${path}.status`), "placed");
    const payment = PAYMENTS.find((p) => p === item.payment_status) ?? (plan.bad(`${path}.payment_status`), "captured");
    const placed = plan.date(item, path, "placed_at");
    const delivered = item.delivered_at === null || item.delivered_at === undefined ? null : plan.date(item, path, "delivered_at");
    const method = item.shipping_method === "express" ? "express" : "standard";
    const discountCode = typeof item.discount_code === "string" ? item.discount_code : null;
    const giftCode = typeof item.gift_card === "string" ? item.gift_card : null;
    const rawLines = Array.isArray(item.lines) ? (item.lines as Body[]) : (plan.bad(`${path}.lines`), []);
    const lines = rawLines.map((l, j) => ({
      key: plan.text(l, `${path}.lines.${j}`, "key"),
      sku: plan.text(l, `${path}.lines.${j}`, "sku"),
      quantity: plan.whole(l, `${path}.lines.${j}`, "quantity", 1),
      fulfillment: FULFILLMENTS.find((f) => f === l.fulfillment) ?? (plan.bad(`${path}.lines.${j}.fulfillment`), "unfulfilled" as Fulfillment),
    }));
    if (!owner || !address || Object.keys(plan.fields).length > 0) continue;
    const found = await rows<{ sku: string; price: number; category: string }>(u.db, "SELECT v.sku, v.price, p.category FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ANY($1)", [lines.map((l) => l.sku)]);
    if (lines.some((l) => !found.some((f) => f.sku === l.sku))) {
      plan.bad(`${path}.lines`);
      continue;
    }
    const price = (sku: string) => found.find((f) => f.sku === sku);
    const rule: DiscountRule | null = discountCode ? await findDiscount(u.db, discountCode) : null;
    const balance = giftCode ? await giftcards.balanceOf(u.db, giftCode) : 0;
    const result = compute(lines.map((l) => ({ id: l.key, unitPrice: price(l.sku)?.price ?? 0, quantity: l.quantity, category: price(l.sku)?.category ?? "" })), rule, method, balance);
    const byKey = new Map(result.lines.map((a) => [a.id, a]));
    const draw = (f: Fulfillment): Account | null => (f === "unfulfilled" || f === "packed" ? "committed" : f === "cancelled" ? null : "dispatched");
    const order = await insertOrder(u.db, {
      userId: owner.id,
      kind: "sale",
      status,
      paymentBase: payment,
      placedAt: placed,
      deliveredAt: delivered,
      email: owner.email,
      phone: address.phone,
      address: address.value,
      shippingMethod: method,
      gift: false,
      giftMessage: "",
      discountCode: rule ? discountCode : null,
      giftCardCode: result.totals.gift_card > 0 ? giftCode : null,
      lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPrice: price(l.sku)?.price ?? 0, discount: byKey.get(l.key)?.discount ?? 0, tax: byKey.get(l.key)?.tax ?? 0, fulfillment: l.fulfillment, allocations: [{ location: "bhiwandi" as const, quantity: l.quantity }] })),
      subtotal: result.totals.subtotal,
      discount: result.totals.discount,
      shipping: result.totals.shipping,
      tax: result.totals.tax,
      shippingTax: result.shippingTax,
      grand: result.grand,
      giftCardAmount: result.totals.gift_card,
      cardAmount: result.totals.total,
      cardLast4: result.totals.total > 0 ? "4242" : null,
      confirmationEmailedAt: placed,
      events: timeline(status, placed, delivered),
    });
    for (const [j, l] of lines.entries()) {
      const to = draw(l.fulfillment);
      if (to) await move(u.db, { sku: l.sku, location: "bhiwandi", reason: to === "committed" ? "order_committed" : "shipped", ref: `order:${order.number}`, from: "external", to, quantity: l.quantity, at: placed });
      const lineId = order.lineIds[j];
      if (lineId) plan.lines.set(l.key, { id: lineId, orderId: order.id, sku: l.sku, deliveredAt: delivered, category: price(l.sku)?.category ?? "" });
      if (lineId) plan.ids[l.key] = lineId;
      plan.touched.add(l.sku);
    }
    if (result.totals.gift_card > 0 && giftCode) await giftcards.spend(u.db, giftCode, result.totals.gift_card, order.number, placed);
    plan.ids[key] = order.number;
  }
}

async function addCase(u: Unit, plan: Plan, kind: CaseKind, path: string, item: Body, extra: Record<string, unknown>): Promise<void> {
  const line = plan.lines.get(plan.text(item, path, "order_line") || plan.text(item, path, "registration"));
  if (!line) {
    plan.bad(`${path}.order_line`);
    return;
  }
  const status = plan.text(item, path, "status");
  const owner = await one<{ user_id: string }>(u.db, "SELECT o.user_id FROM orders o WHERE o.id = $1", [line.orderId]);
  const { rows: [seq] } = await u.db.query<{ n: number }>(`SELECT nextval('${kind === "return" ? "return" : kind === "trial" ? "trial" : "claim"}_number_seq') AS n`);
  const number = `${CASE_NUMBER_PREFIX[kind]}-${seq?.n}`;
  const columns = ["kind", "number", "user_id", "order_line_id", "status", ...Object.keys(extra)];
  const values = [kind, number, owner?.user_id, line.id, status, ...Object.values(extra)];
  const { rows: [created] } = await u.db.query<{ id: string }>(`INSERT INTO cases (${columns.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, values);
  await u.db.query("INSERT INTO case_history (case_id, status, at) VALUES ($1, $2, now())", [created?.id, status]);
  plan.ids[plan.text(item, path, "key")] = number;
}

async function cases(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "returns").entries()) {
    const path = `returns.${i}`;
    await addCase(u, plan, "return", path, item, { quantity: plan.whole(item, path, "quantity", 1), request_reason: plan.text(item, path, "reason"), outcome: item.outcome === "exchange" ? "exchange" : "refund", exchange_sku: typeof item.exchange_sku === "string" ? item.exchange_sku : null });
  }
  for (const [i, item] of plan.list(body, "trials").entries()) await addCase(u, plan, "trial", `trials.${i}`, item, { note: "" });
  for (const [i, item] of plan.list(body, "warranty_registrations").entries()) {
    const path = `warranty_registrations.${i}`;
    const line = plan.lines.get(plan.text(item, path, "order_line"));
    if (!line || !line.deliveredAt) {
      plan.bad(`${path}.order_line`);
      continue;
    }
    const owner = await one<{ user_id: string }>(u.db, "SELECT user_id FROM orders WHERE id = $1", [line.orderId]);
    const { rows: [created] } = await u.db.query<{ id: string }>("INSERT INTO warranty_registrations (order_line_id, user_id, covered_until) VALUES ($1, $2, $3) RETURNING id", [line.id, owner?.user_id, warrantyEnd(line.deliveredAt, line.category)]);
    if (created) {
      plan.registrations.set(plan.text(item, path, "key"), { id: created.id });
      plan.ids[plan.text(item, path, "key")] = created.id;
    }
  }
  for (const [i, item] of plan.list(body, "warranty_claims").entries()) {
    const path = `warranty_claims.${i}`;
    const registration = plan.registrations.get(plan.text(item, path, "registration"));
    if (!registration) {
      plan.bad(`${path}.registration`);
      continue;
    }
    const line = await one<{ order_line_id: string }>(u.db, "SELECT order_line_id FROM warranty_registrations WHERE id = $1", [registration.id]);
    const key = [...plan.lines.entries()].find(([, v]) => v.id === line?.order_line_id)?.[0] ?? "";
    await addCase(u, plan, "claim", path, { ...item, order_line: key }, { registration_id: registration.id, component: plan.text(item, path, "component"), description: plan.text(item, path, "description") });
  }
}

async function holds(u: Unit, body: Body, plan: Plan): Promise<void> {
  for (const [i, item] of plan.list(body, "holds").entries()) {
    const path = `holds.${i}`;
    const owner = plan.users.get(plan.text(item, path, "user"));
    if (!owner) plan.bad(`${path}.user`);
    const reserved = plan.date(item, path, "reserved_at");
    const rawLines = Array.isArray(item.lines) ? (item.lines as Body[]) : (plan.bad(`${path}.lines`), []);
    const lines = rawLines.map((l, j) => ({ sku: plan.text(l, `${path}.lines.${j}`, "sku"), quantity: plan.whole(l, `${path}.lines.${j}`, "quantity", 1) }));
    if (!owner || Object.keys(plan.fields).length > 0) continue;
    const { rows: [created] } = await u.db.query<{ id: string }>("INSERT INTO checkouts (user_id, reserved_at) VALUES ($1, $2) RETURNING id", [owner.id, reserved]);
    if (!created) throw new Error("checkout inserted");
    const by = await figures(u.db, lines.map((l) => l.sku));
    for (const l of lines) {
      const levels = by.get(l.sku);
      if (!levels || holdable(levels) < l.quantity) {
        plan.bad(`${path}.lines`);
        continue;
      }
      await u.db.query("INSERT INTO checkout_lines (checkout_id, sku, quantity, unit_price) VALUES ($1, $2, $3, (SELECT price FROM variants WHERE sku = $2))", [created.id, l.sku, l.quantity]);
      const chunk = takeFrom(levels, l.quantity);
      await move(u.db, { sku: l.sku, location: chunk.location, reason: "hold_placed", ref: `checkout:${created.id}`, from: "available", to: "reserved", quantity: chunk.quantity, at: reserved });
      await u.db.query("INSERT INTO hold_chunks (checkout_id, sku, location, quantity) VALUES ($1, $2, $3, $4)", [created.id, l.sku, chunk.location, chunk.quantity]);
      levels[chunk.location].available -= chunk.quantity;
      plan.touched.add(l.sku);
    }
    plan.ids[plan.text(item, path, "key")] = created.id;
  }
}

export async function runSetup(body: Body): Promise<{ ids: Record<string, string>; sessions: Record<string, string> }> {
  const plan = new Plan();
  const result = await unit(async (u) => {
    await users(u, body, plan);
    await addresses(u, body, plan);
    await products(u, body, plan);
    await stock(u, body, plan);
    await codes(u, body, plan);
    await carts(u, body, plan);
    await orders(u, body, plan);
    await cases(u, body, plan);
    await holds(u, body, plan);
    if (Object.keys(plan.fields).length > 0) throw validation(plan.fields);
    await announceStock(u, [...plan.touched]);
    return { ids: plan.ids, sessions: plan.sessions };
  });
  return result;
}
