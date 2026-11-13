import { randomUUID } from "node:crypto";
import type { AdminOrder, AdminProduct, AdminVariant, InventoryRow, OrderStatus, Role, StockMovement, UploadedImage } from "../shared/api";
import { audit } from "./audit";
import { type SessionUser } from "./auth";
import { loadCatalogue, sizeLabel } from "./catalogue";
import { emit, one, rows, type Queryable, type Unit } from "./db";
import { FIELD, fail, validation } from "./errors";
import { canMoveOrder, STAFF_ORDER_TARGETS } from "./machines";
import { allocationsOf, announceOrder, cancelOrder, findByNumber, orderBody, orderLines, paymentStatus, reach, refundedOf } from "./orders";
import { LOCATIONS, announceCollections, announceStock, figures, isLowStock, lockVariants, move, totalAvailable, type Location } from "./stock";
import { putVerified } from "./storage";
import { detect } from "./sniff";
import type { Fields } from "./validate";

// Operations: catalogue, stock, images and fulfilment. Every write carries the record's version and appends an audit entry.

export function requireRole(user: SessionUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw fail("forbidden");
}

export const asActor = (user: SessionUser) => ({ id: user.id, role: user.role });

// ---- products and variants ---------------------------------------------------------------

async function variantsOf(db: Queryable, productId: string): Promise<AdminVariant[]> {
  const found = await rows<{ sku: string; colour: string; size_slug: string; version: number; price: number; compare_at: number | null }>(
    db,
    "SELECT sku, colour, size_slug, version, price, compare_at FROM variants WHERE product_id = $1 ORDER BY position",
    [productId],
  );
  const stock = await figures(db, found.map((v) => v.sku));
  return found.map((v) => ({
    sku: v.sku,
    colour: v.colour,
    size: sizeLabel(v.size_slug),
    version: v.version,
    price: v.price,
    compare_at: v.compare_at,
    stock: LOCATIONS.map((location) => ({ location, available: stock.get(v.sku)?.[location].available ?? 0 })),
  }));
}

async function adminProduct(db: Queryable, row: { id: string; slug: string; name: string; status: AdminProduct["status"]; version: number }): Promise<AdminProduct> {
  const variants = await variantsOf(db, row.id);
  return { slug: row.slug, name: row.name, status: row.status, version: row.version, colours: [...new Set(variants.map((v) => v.colour))], variants };
}

export async function listProducts(db: Queryable): Promise<AdminProduct[]> {
  const found = await rows<{ id: string; slug: string; name: string; status: AdminProduct["status"]; version: number }>(db, "SELECT id, slug, name, status, version FROM products ORDER BY featured_rank");
  return Promise.all(found.map((p) => adminProduct(db, p)));
}

export async function findProduct(db: Queryable, slug: string): Promise<{ id: string; slug: string; name: string; status: AdminProduct["status"]; version: number }> {
  const row = await one<{ id: string; slug: string; name: string; status: AdminProduct["status"]; version: number }>(db, "SELECT id, slug, name, status, version FROM products WHERE slug = $1", [slug]);
  if (!row) throw fail("not_found");
  return row;
}

export async function getProduct(db: Queryable, slug: string): Promise<AdminProduct> {
  return adminProduct(db, await findProduct(db, slug));
}

export async function patchProduct(u: Unit, user: SessionUser, slug: string, input: Record<string, unknown>, now: Date): Promise<AdminProduct> {
  const product = await one<{ id: string; status: string; version: number }>(u.db, "SELECT id, status, version FROM products WHERE slug = $1 FOR UPDATE", [slug]);
  if (!product) throw fail("not_found");
  if (input.version !== product.version) throw fail("stale_version");
  if (input.status !== "draft" && input.status !== "published" && input.status !== "archived") throw validation({ status: FIELD.productStatus });
  await u.db.query("UPDATE products SET status = $2, version = version + 1, published_at = CASE WHEN $2 = 'published' THEN coalesce(published_at, $3) ELSE published_at END WHERE id = $1", [product.id, input.status, now]);
  await audit(u, asActor(user), "status_changed", "product", slug, { status: product.status }, { status: input.status }, now);
  const skus = (await rows<{ sku: string }>(u.db, "SELECT sku FROM variants WHERE product_id = $1", [product.id])).map((v) => v.sku);
  await announceCollections(u, skus);
  return getProduct(u.db, slug);
}

function wholeBetween(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export async function patchVariant(u: Unit, user: SessionUser, sku: string, input: Record<string, unknown>, now: Date): Promise<AdminVariant> {
  await lockVariants(u.db, [sku]);
  const variant = await one<{ sku: string; price: number; compare_at: number | null; version: number; product_id: string }>(u.db, "SELECT sku, price, compare_at, version, product_id FROM variants WHERE sku = $1", [sku]);
  if (!variant) throw fail("not_found");
  if (input.version !== variant.version) throw fail("stale_version");
  const fields: Fields = {};
  let price = variant.price;
  if ("price" in input) {
    const parsed = wholeBetween(input.price, 1, 999_999);
    if (parsed === null) fields.price = FIELD.price;
    else price = parsed;
  }
  let compareAt = variant.compare_at;
  if ("compare_at" in input) {
    if (input.compare_at === null) compareAt = null;
    else if (typeof input.compare_at === "number" && Number.isInteger(input.compare_at) && input.compare_at > price) compareAt = input.compare_at;
    else fields.compare_at = FIELD.compareAt;
  } else if (compareAt !== null && compareAt <= price) {
    fields.compare_at = FIELD.compareAt;
  }
  const changes: { location: Location; target: number }[] = [];
  if ("stock" in input) {
    const list = Array.isArray(input.stock) ? input.stock : [];
    list.forEach((item: unknown, index) => {
      const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
      const location = LOCATIONS.find((l) => l === entry.location);
      const target = wholeBetween(entry.available, 0, 9999);
      if (!location) fields[`stock.${index}.location`] = FIELD.location;
      if (target === null) fields[`stock.${index}.available`] = FIELD.available;
      if (location && target !== null) changes.push({ location, target });
    });
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const actor = asActor(user);
  if (price !== variant.price) await audit(u, actor, "price_changed", "variant", sku, { price: variant.price }, { price }, now);
  if (compareAt !== variant.compare_at) await audit(u, actor, "compare_at_changed", "variant", sku, { compare_at: variant.compare_at }, { compare_at: compareAt }, now);
  await u.db.query("UPDATE variants SET price = $2, compare_at = $3, version = version + 1 WHERE sku = $1", [sku, price, compareAt]);
  const stock = (await figures(u.db, [sku])).get(sku);
  let restocked = false;
  for (const { location, target } of changes) {
    const current = stock?.[location].available ?? 0;
    if (target === current) continue;
    const increase = target > current;
    await move(u.db, { sku, location, reason: increase ? "stock_received" : "stock_adjusted", ref: `staff:${user.id}`, from: increase ? "external" : "available", to: increase ? "available" : "external", quantity: Math.abs(target - current), at: now });
    await audit(u, actor, "stock_adjusted", "variant", sku, { location, available: current }, { location, available: target }, now);
    restocked = true;
  }
  if (price !== variant.price || compareAt !== variant.compare_at) emit(u, "price", { sku, price, compare_at: compareAt }, "all");
  await (restocked ? announceStock(u, [sku]) : announceCollections(u, [sku]));
  const found = (await variantsOf(u.db, variant.product_id)).find((v) => v.sku === sku);
  if (!found) throw fail("not_found");
  return found;
}

// ---- images ------------------------------------------------------------------------------

export async function addImage(u: Unit, user: SessionUser, slug: string, form: { colour: string; alt: string; bytes: Buffer }, now: Date): Promise<UploadedImage> {
  const product = await findProduct(u.db, slug);
  const id = randomUUID();
  const type = detect(form.bytes);
  if (!type || type.kind !== "photo") throw fail("unsupported_image");
  await putVerified(`products/${slug}/${id}`, form.bytes, type.contentType, "image");
  await u.db.query("INSERT INTO product_images (id, product_id, colour, alt, content_type, bytes, storage_key) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, product.id, form.colour, form.alt, type.contentType, form.bytes.length, `products/${slug}/${id}`]);
  await audit(u, asActor(user), "image_added", "product", slug, null, { image_id: id, colour: form.colour, alt: form.alt, position: 1 }, now);
  const skus = (await rows<{ sku: string }>(u.db, "SELECT sku FROM variants WHERE product_id = $1", [product.id])).map((v) => v.sku);
  await announceCollections(u, skus);
  return { id, colour: form.colour, alt: form.alt, position: 1, url: `/media/products/${id}` };
}

export async function productColours(db: Queryable, slug: string): Promise<string[]> {
  const found = await rows<{ colour: string }>(db, "SELECT DISTINCT v.colour, min(v.position) AS first FROM variants v JOIN products p ON p.id = v.product_id WHERE p.slug = $1 GROUP BY v.colour ORDER BY first", [slug]);
  return found.map((r) => r.colour);
}

// ---- inventory ---------------------------------------------------------------------------

export async function inventory(db: Queryable, lowOnly: boolean): Promise<InventoryRow[]> {
  const entries = await loadCatalogue(db);
  const skus = entries.flatMap((p) => p.variants.map((v) => v.sku));
  const stock = await figures(db, skus);
  const out: InventoryRow[] = [];
  for (const product of entries) {
    for (const v of product.variants) {
      const by = stock.get(v.sku);
      if (!by) continue;
      const available = totalAvailable(by);
      if (lowOnly && !isLowStock(available)) continue;
      const locations = LOCATIONS.map((location) => ({
        location,
        available: by[location].available,
        reserved: by[location].reserved,
        committed: by[location].committed,
        on_hand: by[location].available + by[location].reserved,
      }));
      out.push({ sku: v.sku, product: product.name, colour: v.colour, size: sizeLabel(v.size_slug), locations, available, on_hand: locations.reduce((n, l) => n + l.on_hand, 0) });
    }
  }
  return out;
}

export async function movements(db: Queryable, sku: string): Promise<StockMovement[]> {
  if (!(await one(db, "SELECT 1 FROM variants WHERE sku = $1", [sku]))) throw fail("not_found");
  const moves = await rows<{ id: string; reason: string; ref: string; at: Date }>(
    db,
    "SELECT DISTINCT m.id, m.seq, m.reason, m.ref, m.at FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id WHERE e.sku = $1 ORDER BY m.seq DESC",
    [sku],
  );
  const entries = await rows<{ movement_id: string; account: string; location: string; quantity: number }>(db, "SELECT movement_id, account, location, quantity FROM stock_entries WHERE movement_id = ANY($1) ORDER BY id", [moves.map((m) => m.id)]);
  return moves.map((m) => ({
    movement_id: m.id,
    reason: m.reason,
    ref: m.ref,
    at: m.at.toISOString(),
    entries: entries.filter((e) => e.movement_id === m.id).map((e) => ({ account: e.account, location: e.location, quantity: e.quantity })),
  }));
}

// ---- orders ------------------------------------------------------------------------------

interface Customer {
  id: string;
  name: string;
  email: string;
}

export async function adminOrder(db: Queryable, number: string, now: Date): Promise<AdminOrder> {
  const order = await findByNumber(db, number);
  const customer = await one<Customer>(db, "SELECT id, name, email FROM users WHERE id = $1", [order.user_id]);
  if (!customer) throw fail("not_found");
  return { ...(await orderBody(db, order, now)), customer };
}

export async function listOrders(db: Queryable, q: string, status: string): Promise<object[]> {
  const found = await rows<{ number: string; status: OrderStatus; version: number; placed_at: Date; payment_base: "pending" | "authorized" | "captured" | "failed"; grand_total: number; card_amount: number; gift_card_amount: number; card_last4: string | null; id: string; subtotal: number; discount: number; shipping: number; tax: number; name: string; email: string; user_id: string }>(
    db,
    `SELECT o.id, o.number, o.status, o.version, o.placed_at, o.payment_base, o.grand_total, o.card_amount, o.gift_card_amount, o.card_last4, o.subtotal, o.discount, o.shipping, o.tax, u.name, u.email, u.id AS user_id
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE ($1 = '' OR o.number ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%') AND ($2 = '' OR o.status = $2)
     ORDER BY o.placed_at DESC, o.number DESC LIMIT 300`,
    [q, status],
  );
  const refunds = new Map((await rows<{ order_id: string; n: number }>(db, "SELECT order_id, sum(amount) AS n FROM refunds WHERE order_id = ANY($1) GROUP BY order_id", [found.map((o) => o.id)])).map((r) => [r.order_id, r.n]));
  return found.map((o) => {
    const refunded = refunds.get(o.id) ?? 0;
    return {
      number: o.number,
      status: o.status,
      version: o.version,
      placed_at: o.placed_at.toISOString(),
      payment: { status: paymentStatus(o, refunded), amount: o.grand_total, card_amount: o.card_amount, gift_card_amount: o.gift_card_amount, card_last4: o.card_last4, refunded },
      totals: { subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, tax: o.tax, gift_card: o.gift_card_amount, total: o.card_amount },
      customer: { id: o.user_id, name: o.name, email: o.email },
    };
  });
}

export async function setOrderStatus(u: Unit, user: SessionUser, number: string, input: Record<string, unknown>, now: Date): Promise<AdminOrder> {
  const order = await findByNumber(u.db, number, undefined, true);
  if (input.version !== order.version) throw fail("stale_version");
  const target = STAFF_ORDER_TARGETS.find((s) => s === input.status);
  if (!target) throw validation({ status: FIELD.orderStatus });
  if (!canMoveOrder(order.status, target)) throw fail("invalid_transition");
  const actor = asActor(user);
  if (target === "cancelled") {
    const before = { status: order.status, payment_status: paymentStatus(order, await refundedOf(u.db, order.id)) };
    await cancelOrder(u, order, now);
    const after = await findByNumber(u.db, number);
    await audit(u, actor, "cancelled", "order", number, before, { status: after.status, payment_status: paymentStatus(after, await refundedOf(u.db, order.id)) }, now);
  } else {
    if (target === "packed") await u.db.query("UPDATE order_lines SET fulfillment = 'packed' WHERE order_id = $1 AND fulfillment = 'unfulfilled'", [order.id]);
    if (target === "out_for_delivery") await u.db.query("UPDATE order_lines SET fulfillment = 'out_for_delivery' WHERE order_id = $1 AND fulfillment = 'shipped'", [order.id]);
    if (target === "delivered") {
      await u.db.query("UPDATE order_lines SET fulfillment = 'delivered' WHERE order_id = $1 AND fulfillment = 'out_for_delivery'", [order.id]);
      await u.db.query("UPDATE orders SET delivered_at = $2 WHERE id = $1", [order.id, now]);
    }
    await reach(u, order, target, now);
    await audit(u, actor, "status_changed", "order", number, { status: order.status }, { status: target }, now);
    await announceOrder(u, order);
  }
  return adminOrder(u.db, number, now);
}

const CARRIERS = ["Coastline Couriers", "Peak Express"];

export async function createShipment(u: Unit, user: SessionUser, number: string, input: Record<string, unknown>, now: Date): Promise<AdminOrder> {
  const order = await findByNumber(u.db, number, undefined, true);
  if (input.version !== order.version) throw fail("stale_version");
  if (order.status !== "packed" && order.status !== "partially_shipped") throw fail("invalid_transition");
  const lines = await orderLines(u.db, order.id);
  const ids = Array.isArray(input.line_ids) ? input.line_ids.filter((id): id is string => typeof id === "string") : [];
  const chosen = lines.filter((l) => ids.includes(l.id));
  if (chosen.some((l) => l.fulfillment !== "packed")) throw fail("invalid_transition");
  const fields: Fields = {};
  if (chosen.length === 0 || chosen.length !== new Set(ids).size) fields.line_ids = FIELD.lineIds;
  const carrier = CARRIERS.find((c) => c === input.carrier);
  if (!carrier) fields.carrier = FIELD.carrier;
  const tracking = typeof input.tracking_number === "string" ? input.tracking_number : "";
  if (!/^[A-Z0-9-]{6,30}$/.test(tracking)) fields.tracking_number = FIELD.tracking;
  if (Object.keys(fields).length > 0) throw validation(fields);

  const before = chosen.map((l) => ({ id: l.id, fulfillment: l.fulfillment }));
  const allocations = (await allocationsOf(u.db, order.id)).filter((a) => chosen.some((l) => l.id === a.line_id));
  await lockVariants(u.db, allocations.map((a) => a.sku));
  for (const a of allocations) {
    await move(u.db, { sku: a.sku, location: a.location, reason: "shipped", ref: `order:${number}`, from: "committed", to: "dispatched", quantity: a.quantity, at: now });
  }
  await u.db.query("UPDATE order_lines SET fulfillment = 'shipped', carrier = $2, tracking_number = $3 WHERE id = ANY($1)", [chosen.map((l) => l.id), carrier, tracking]);
  const remaining = lines.filter((l) => l.fulfillment === "packed" && !ids.includes(l.id)).length;
  const status: OrderStatus = remaining === 0 ? "shipped" : "partially_shipped";
  await reach(u, order, status, now);
  await audit(u, asActor(user), "shipment_created", "order", number, { status: order.status, lines: before }, { status, lines: chosen.map((l) => ({ id: l.id, fulfillment: "shipped" })) }, now);
  await announceOrder(u, order);
  return adminOrder(u.db, number, now);
}

