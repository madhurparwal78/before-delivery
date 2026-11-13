import type { Cart, CartLine, ShippingMethod } from "../shared/api";
import type { Session } from "./auth";
import { sizeLabel } from "./catalogue";
import { checkDiscount } from "./codes";
import { emit, one, rows, type Db, type Queryable, type Unit } from "./db";
import { FIELD, alreadyRedeemed, clampNotice, fail, outOfStock, validation } from "./errors";
import * as giftcards from "./giftcards";
import { badgeFor, figures, lockVariants, totalAvailable, variantName } from "./stock";
import { compute, type DiscountRule, type PricedLine } from "./totals";

export interface CartRow {
  id: string;
  sku: string;
  quantity: number;
  product_name: string;
  colour: string;
  size_slug: string;
  category: string;
  price: number;
  available: number;
}

interface CartHeader {
  shipping_method: ShippingMethod;
  discount_code: string | null;
  gift_card_code: string | null;
}

async function ensureCart(db: Db, owner: string): Promise<CartHeader> {
  await db.query("INSERT INTO carts (owner) VALUES ($1) ON CONFLICT DO NOTHING", [owner]);
  const header = await one<CartHeader>(db, "SELECT shipping_method, discount_code, gift_card_code FROM carts WHERE owner = $1 FOR UPDATE", [owner]);
  if (!header) throw new Error("cart row exists");
  return header;
}

export async function cartRows(db: Queryable, owner: string): Promise<CartRow[]> {
  const lines = await rows<Omit<CartRow, "available">>(
    db,
    `SELECT l.id, l.sku, l.quantity, p.name AS product_name, v.colour, v.size_slug, p.category, v.price
     FROM cart_lines l JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id
     WHERE l.owner = $1 ORDER BY l.position`,
    [owner],
  );
  const stock = await figures(db, lines.map((l) => l.sku));
  return lines.map((l) => ({ ...l, available: totalAvailable(stock.get(l.sku) ?? { bhiwandi: ZERO, gurugram: ZERO }) }));
}

const ZERO = { available: 0, reserved: 0, committed: 0, dispatched: 0 };

export function priced(lines: CartRow[]): PricedLine[] {
  return lines.map((l) => ({ id: l.id, unitPrice: l.price, quantity: l.quantity, category: l.category }));
}

export function lineBody(line: CartRow, amounts: { subtotal: number; discount: number }): CartLine {
  return {
    id: line.id,
    sku: line.sku,
    product: line.product_name,
    colour: line.colour,
    size: sizeLabel(line.size_slug),
    quantity: line.quantity,
    unit_price: line.price,
    line_subtotal: amounts.subtotal,
    line_discount: amounts.discount,
    available: line.available,
    badge: badgeFor(line.available),
  };
}

export async function giftBalanceFor(db: Queryable, code: string | null, signedIn: boolean): Promise<number> {
  return code && signedIn ? giftcards.balanceOf(db, code) : 0;
}

/**
 * The bag as the server sees it now. Reading clamps lines to what is available and drops a code that
 * no longer applies; both come back as notices.
 */
export async function readCart(u: Unit, session: Session, notices: string[] = []): Promise<Cart> {
  const { db } = u;
  const header = await ensureCart(db, session.owner);
  let lines = await cartRows(db, session.owner);
  await lockVariants(db, lines.map((l) => l.sku));
  lines = await cartRows(db, session.owner);
  let changed = false;
  for (const line of lines) {
    if (line.available > 0 && line.quantity > line.available) {
      await db.query("UPDATE cart_lines SET quantity = $2 WHERE id = $1", [line.id, line.available]);
      line.quantity = line.available;
      notices.push(clampNotice(line.available));
      changed = true;
    }
  }
  let rule: DiscountRule | null = null;
  if (header.discount_code) {
    try {
      rule = await checkDiscount(db, header.discount_code, priced(lines), new Date());
    } catch {
      notices.push(`Code ${header.discount_code} no longer applies and was removed.`);
      await db.query("UPDATE carts SET discount_code = NULL WHERE owner = $1", [session.owner]);
      header.discount_code = null;
    }
  }
  if (changed) emit(u, "cart", { count: lines.reduce((n, l) => n + l.quantity, 0) }, "owner", session.owner);
  const balance = await giftBalanceFor(db, header.gift_card_code, session.user !== null);
  const result = compute(priced(lines), rule, header.shipping_method, balance);
  const byId = new Map(result.lines.map((a) => [a.id, a]));
  return {
    count: lines.reduce((n, l) => n + l.quantity, 0),
    lines: lines.map((l) => lineBody(l, byId.get(l.id) ?? { subtotal: 0, discount: 0 })),
    discount: rule && header.discount_code ? { code: header.discount_code, kind: rule.kind, value: rule.value } : null,
    gift_card: header.gift_card_code && session.user ? { last4: header.gift_card_code.slice(-4), balance } : null,
    shipping_method: header.shipping_method,
    totals: result.totals,
    notices,
  };
}

/** Reads the bag and pushes the new count to every session of the owner. */
async function readAndAnnounce(u: Unit, session: Session, notices: string[] = []): Promise<Cart> {
  const cart = await readCart(u, session, notices);
  emit(u, "cart", { count: cart.count }, "owner", session.owner);
  return cart;
}

function checkQuantity(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}

export async function addLine(u: Unit, session: Session, body: Record<string, unknown>): Promise<Cart> {
  const quantity = checkQuantity(body.quantity);
  const variant = typeof body.sku === "string" ? await one<{ sku: string }>(u.db, "SELECT v.sku FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = $1 AND p.status = 'published'", [body.sku]) : null;
  const fields: Record<string, string> = {};
  if (!variant) fields.sku = FIELD.sku;
  if (quantity === null) fields.quantity = FIELD.quantity;
  if (!variant || quantity === null) throw validation(fields);
  await ensureCart(u.db, session.owner);
  await lockVariants(u.db, [variant.sku]);
  const stock = (await figures(u.db, [variant.sku])).get(variant.sku);
  const available = stock ? totalAvailable(stock) : 0;
  if (available <= 0) throw outOfStock(await variantName(u.db, variant.sku), variant.sku, 0);
  const existing = await one<{ quantity: number }>(u.db, "SELECT quantity FROM cart_lines WHERE owner = $1 AND sku = $2", [session.owner, variant.sku]);
  const wanted = Math.min(10, (existing?.quantity ?? 0) + quantity);
  const final = Math.min(wanted, available);
  await u.db.query(
    `INSERT INTO cart_lines (owner, sku, quantity) VALUES ($1, $2, $3) ON CONFLICT (owner, sku) DO UPDATE SET quantity = $3`,
    [session.owner, variant.sku, final],
  );
  const notices = final < wanted ? [clampNotice(available)] : [];
  return readAndAnnounce(u, session, notices);
}

async function ownLine(db: Db, owner: string, id: string): Promise<{ id: string; sku: string }> {
  const line = /^[0-9a-f-]{36}$/.test(id) ? await one<{ id: string; sku: string }>(db, "SELECT id, sku FROM cart_lines WHERE id = $1 AND owner = $2", [id, owner]) : null;
  if (!line) throw fail("not_found");
  return line;
}

export async function setQuantity(u: Unit, session: Session, id: string, body: Record<string, unknown>): Promise<Cart> {
  await ensureCart(u.db, session.owner);
  const line = await ownLine(u.db, session.owner, id);
  const quantity = checkQuantity(body.quantity);
  if (quantity === null) throw validation({ quantity: FIELD.quantity });
  await lockVariants(u.db, [line.sku]);
  const stock = (await figures(u.db, [line.sku])).get(line.sku);
  const available = stock ? totalAvailable(stock) : 0;
  const final = available > 0 ? Math.min(quantity, available) : quantity;
  await u.db.query("UPDATE cart_lines SET quantity = $2 WHERE id = $1", [line.id, final]);
  return readAndAnnounce(u, session, final < quantity ? [clampNotice(available)] : []);
}

export async function removeLine(u: Unit, session: Session, id: string): Promise<Cart> {
  await ensureCart(u.db, session.owner);
  const line = await ownLine(u.db, session.owner, id);
  await u.db.query("DELETE FROM cart_lines WHERE id = $1", [line.id]);
  return readAndAnnounce(u, session);
}

export async function applyCode(u: Unit, session: Session, body: Record<string, unknown>): Promise<Cart> {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) throw validation({ code: FIELD.code });
  await ensureCart(u.db, session.owner);
  if (giftcards.isGiftCode(code)) {
    if (!session.user) throw fail("unauthenticated");
    if (!(await giftcards.exists(u.db, code))) throw fail("code_invalid");
    const balance = await giftcards.balanceOf(u.db, code);
    if (balance <= 0) throw alreadyRedeemed(balance);
    await u.db.query("UPDATE carts SET gift_card_code = $2 WHERE owner = $1", [session.owner, code]);
    return readAndAnnounce(u, session);
  }
  const found = await checkDiscount(u.db, code, priced(await cartRows(u.db, session.owner)), new Date());
  await u.db.query("UPDATE carts SET discount_code = $2 WHERE owner = $1", [session.owner, found.code]);
  return readAndAnnounce(u, session);
}

export async function removeDiscount(u: Unit, session: Session): Promise<Cart> {
  await ensureCart(u.db, session.owner);
  await u.db.query("UPDATE carts SET discount_code = NULL WHERE owner = $1", [session.owner]);
  return readAndAnnounce(u, session);
}

export async function removeGiftCard(u: Unit, session: Session): Promise<Cart> {
  await ensureCart(u.db, session.owner);
  await u.db.query("UPDATE carts SET gift_card_code = NULL WHERE owner = $1", [session.owner]);
  return readAndAnnounce(u, session);
}
