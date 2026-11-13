import type { Address, AppNotification, User, Wishlist } from "../shared/api";
import { createSession, hashPassword, ownerOf, verifyPassword, type Session } from "./auth";
import { emit, isUniqueViolation, one, pool, rows, unit, type Queryable, type Unit } from "./db";
import { FIELD, fail, validation } from "./errors";
import * as giftcards from "./giftcards";
import { checkAddress, checkLabel, type Fields } from "./validate";

// Accounts and sessions, the wishlist, saved addresses and notifications.

const publicUser = (row: User): User => ({ id: row.id, name: row.name, email: row.email, role: row.role });

export async function register(input: Record<string, unknown>, guest: Session): Promise<{ user: User; sessionId: string }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const fields: Fields = {};
  if (name.length < 1 || name.length > 80) fields.name = FIELD.accountName;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.email = FIELD.email;
  if (password.length < 10) fields.password = FIELD.password;
  if (Object.keys(fields).length > 0) throw validation(fields);
  try {
    return await unit(async (u) => {
      const { rows: [created] } = await u.db.query<User>("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer') RETURNING id, name, email, role", [name, email, await hashPassword(password)]);
      if (!created) throw new Error("user inserted");
      const sessionId = await createSession(u.db, created.id);
      if (!guest.user) await merge(u, guest.owner, ownerOf(sessionId, created.id));
      return { user: publicUser(created), sessionId };
    });
  } catch (failure) {
    if (isUniqueViolation(failure)) throw fail("email_taken");
    throw failure;
  }
}

/** Signs in with a fresh session and merges the guest bag and wishlist into the account. */
export async function signIn(input: Record<string, unknown>, guest: Session): Promise<{ user: User; sessionId: string }> {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const found = await one<User & { password_hash: string }>(pool, "SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)", [email]);
  if (!found || !(await verifyPassword(password, found.password_hash))) throw fail("invalid_credentials");
  return unit(async (u) => {
    const sessionId = await createSession(u.db, found.id);
    if (!guest.user) await merge(u, guest.owner, ownerOf(sessionId, found.id));
    return { user: publicUser(found), sessionId };
  });
}

/** Wishlists are unioned, bag quantities are added and clamped on the next read, and the guest copies are emptied. */
async function merge(u: Unit, from: string, to: string): Promise<void> {
  await u.db.query("INSERT INTO wishlist_items (owner, product_id, saved_at) SELECT $2, product_id, saved_at FROM wishlist_items WHERE owner = $1 ON CONFLICT DO NOTHING", [from, to]);
  await u.db.query("DELETE FROM wishlist_items WHERE owner = $1", [from]);
  await u.db.query("INSERT INTO carts (owner) VALUES ($1), ($2) ON CONFLICT DO NOTHING", [from, to]);
  await u.db.query(
    `INSERT INTO cart_lines (owner, sku, quantity) SELECT $2, sku, quantity FROM cart_lines WHERE owner = $1
     ON CONFLICT (owner, sku) DO UPDATE SET quantity = least(10, cart_lines.quantity + EXCLUDED.quantity)`,
    [from, to],
  );
  await u.db.query("DELETE FROM cart_lines WHERE owner = $1", [from]);
  await u.db.query("UPDATE carts t SET discount_code = coalesce(t.discount_code, g.discount_code) FROM carts g WHERE g.owner = $1 AND t.owner = $2", [from, to]);
  await u.db.query("UPDATE carts SET discount_code = NULL, gift_card_code = NULL WHERE owner = $1", [from]);
  await announceWishlist(u, from);
  await announceWishlist(u, to);
  const guestCount = await one<{ n: number }>(u.db, "SELECT coalesce(sum(quantity), 0) AS n FROM cart_lines WHERE owner = $1", [from]);
  const count = await one<{ n: number }>(u.db, "SELECT coalesce(sum(quantity), 0) AS n FROM cart_lines WHERE owner = $1", [to]);
  emit(u, "cart", { count: guestCount?.n ?? 0 }, "owner", from);
  emit(u, "cart", { count: count?.n ?? 0 }, "owner", to);
}

export async function signOut(sessionId: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

// ---- wishlist ------------------------------------------------------------------------------

export async function wishlistOf(db: Queryable, owner: string): Promise<Wishlist> {
  const items = await rows<{ slug: string; name: string; saved_at: Date }>(
    db,
    `SELECT p.slug, p.name, w.saved_at FROM wishlist_items w JOIN products p ON p.id = w.product_id
     WHERE w.owner = $1 AND p.status = 'published' ORDER BY w.saved_at DESC, p.name`,
    [owner],
  );
  return { count: items.length, items: items.map((i) => ({ slug: i.slug, name: i.name, saved_at: i.saved_at.toISOString() })) };
}

async function announceWishlist(u: Unit, owner: string): Promise<Wishlist> {
  const wishlist = await wishlistOf(u.db, owner);
  emit(u, "wishlist", { count: wishlist.count, slugs: wishlist.items.map((i) => i.slug) }, "owner", owner);
  return wishlist;
}

export async function save(u: Unit, owner: string, slug: string): Promise<Wishlist> {
  const product = await one<{ id: string }>(u.db, "SELECT id FROM products WHERE slug = $1 AND status = 'published'", [slug]);
  if (!product) throw fail("not_found");
  await u.db.query("INSERT INTO wishlist_items (owner, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [owner, product.id]);
  return announceWishlist(u, owner);
}

export async function unsave(u: Unit, owner: string, slug: string): Promise<Wishlist> {
  await u.db.query("DELETE FROM wishlist_items WHERE owner = $1 AND product_id = (SELECT id FROM products WHERE slug = $2)", [owner, slug]);
  return announceWishlist(u, owner);
}

// ---- addresses, notifications, gift cards ----------------------------------------------------

export function listAddresses(db: Queryable, userId: string): Promise<Address[]> {
  return rows<Address>(db, "SELECT id, label, name, line1, line2, city, state, postcode, phone FROM addresses WHERE user_id = $1 ORDER BY created_at, label", [userId]);
}

export async function addAddress(db: Queryable, userId: string, input: Record<string, unknown>): Promise<Address> {
  const fields: Fields = {};
  const label = checkLabel(input.label, fields);
  const address = checkAddress(input, fields, "");
  if (Object.keys(fields).length > 0) throw validation(fields);
  const created = await one<Address>(
    db,
    `INSERT INTO addresses (user_id, label, name, line1, line2, city, state, postcode, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, label, name, line1, line2, city, state, postcode, phone`,
    [userId, label, address.name, address.line1, address.line2, address.city, address.state, address.postcode, address.phone],
  );
  if (!created) throw new Error("address inserted");
  return created;
}

export async function removeAddress(db: Queryable, userId: string, id: string): Promise<void> {
  const deleted = /^[0-9a-f-]{36}$/.test(id) ? await db.query("DELETE FROM addresses WHERE id = $1 AND user_id = $2", [id, userId]) : null;
  if (!deleted || deleted.rowCount === 0) throw fail("not_found");
}

export async function notificationsOf(db: Queryable, userId: string): Promise<AppNotification[]> {
  const found = await rows<{ id: string; text: string; created_at: Date; email_status: "emailed" | "pending" }>(db, "SELECT id, text, created_at, email_status FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id", [userId]);
  return found.map((n) => ({ id: n.id, text: n.text, at: n.created_at.toISOString(), email_status: n.email_status }));
}

export async function giftCardView(db: Queryable, code: string): Promise<{ last4: string; balance: number }> {
  const normalised = code.trim().toUpperCase();
  if (!(await giftcards.exists(db, normalised))) throw fail("not_found");
  return { last4: normalised.slice(-4), balance: await giftcards.balanceOf(db, normalised) };
}

