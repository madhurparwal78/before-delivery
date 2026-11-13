import { randomUUID } from 'node:crypto';
import { db, tx } from '../db/pool';
import {
  FIELD_COPY,
  emailTaken,
  invalidCredentials,
  notFound
} from '../errors';
import { Ctx, requireUser, sessionCookie } from '../http/context';
import { sendJson } from '../http/respond';
import { route } from '../http/router';
import {
  EMAIL_PATTERN,
  FieldErrors,
  readString,
  validateAddress
} from '../http/validate';
import { ensureCart, loadCart } from '../domain/cart';
import { publishWishlist } from '../domain/events';
import { giftCardBalance, giftCardExists, giftCardLast4 } from '../domain/giftcards';
import { hashPassword, verifyPassword } from '../domain/passwords';
import { Db } from '../db/pool';

async function ensureWishlist(client: Db, owner: { sessionId: string; userId: string | null }): Promise<string> {
  const existing =
    owner.userId === null
      ? await client.one<{ id: string }>('SELECT id FROM wishlists WHERE session_id = $1', [owner.sessionId])
      : await client.one<{ id: string }>('SELECT id FROM wishlists WHERE user_id = $1', [owner.userId]);
  if (existing !== null) return existing.id;
  const id = randomUUID();
  await client.query('INSERT INTO wishlists (id, session_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
    id,
    owner.userId === null ? owner.sessionId : null,
    owner.userId
  ]);
  const created =
    owner.userId === null
      ? await client.one<{ id: string }>('SELECT id FROM wishlists WHERE session_id = $1', [owner.sessionId])
      : await client.one<{ id: string }>('SELECT id FROM wishlists WHERE user_id = $1', [owner.userId]);
  if (created === null) throw new Error('wishlist could not be created');
  return created.id;
}

export type WishlistView = { count: number; items: Array<{ slug: string; name: string; saved_at: string }> };

export async function loadWishlist(
  client: Db,
  owner: { sessionId: string; userId: string | null }
): Promise<WishlistView> {
  const wishlistId = await ensureWishlist(client, owner);
  const rows = await client.query<{ slug: string; name: string; saved_at: Date }>(
    `SELECT p.slug, p.name, w.saved_at FROM wishlist_items w
     JOIN products p ON p.id = w.product_id
     WHERE w.wishlist_id = $1 ORDER BY w.saved_at DESC, p.name ASC`,
    [wishlistId]
  );
  return {
    count: rows.length,
    items: rows.map((row) => ({ slug: row.slug, name: row.name, saved_at: row.saved_at.toISOString() }))
  };
}

async function mergeGuestIntoAccount(client: Db, sessionId: string, userId: string): Promise<void> {
  const guestWishlist = await client.one<{ id: string }>('SELECT id FROM wishlists WHERE session_id = $1', [
    sessionId
  ]);
  if (guestWishlist !== null) {
    const accountWishlist = await ensureWishlist(client, { sessionId, userId });
    await client.query(
      `INSERT INTO wishlist_items (wishlist_id, product_id, saved_at)
       SELECT $1, product_id, saved_at FROM wishlist_items WHERE wishlist_id = $2
       ON CONFLICT (wishlist_id, product_id) DO NOTHING`,
      [accountWishlist, guestWishlist.id]
    );
    await client.query('DELETE FROM wishlist_items WHERE wishlist_id = $1', [guestWishlist.id]);
  }

  const guestCart = await client.one<{ id: string; discount_code: string | null }>(
    'SELECT id, discount_code FROM carts WHERE session_id = $1',
    [sessionId]
  );
  if (guestCart !== null) {
    const accountCart = await ensureCart(client, { sessionId, userId });
    const lines = await client.query<{ variant_id: string; quantity: number }>(
      'SELECT variant_id, quantity FROM cart_lines WHERE cart_id = $1',
      [guestCart.id]
    );
    for (const line of lines) {
      await client.query(
        `INSERT INTO cart_lines (id, cart_id, variant_id, quantity) VALUES ($1, $2, $3, $4)
         ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_lines.quantity + EXCLUDED.quantity`,
        [randomUUID(), accountCart.id, line.variant_id, line.quantity]
      );
    }
    await client.query('DELETE FROM cart_lines WHERE cart_id = $1', [guestCart.id]);
    if (guestCart.discount_code !== null && accountCart.discount_code === null) {
      await client.query('UPDATE carts SET discount_code = $2 WHERE id = $1', [
        accountCart.id,
        guestCart.discount_code
      ]);
    }
    await client.query('UPDATE carts SET discount_code = NULL, gift_card_code = NULL WHERE id = $1', [guestCart.id]);
  }
}

async function attachSession(ctx: Ctx, userId: string): Promise<void> {
  await tx(async (client) => {
    await mergeGuestIntoAccount(client, ctx.sessionId, userId);
    await client.query('UPDATE sessions SET user_id = $2 WHERE id = $1', [ctx.sessionId, userId]);
    const wishlist = await loadWishlist(client, { sessionId: ctx.sessionId, userId });
    await publishWishlist(client, userId, wishlist.count, wishlist.items.map((item) => item.slug));
    await loadCart(client, { sessionId: ctx.sessionId, userId });
  });
  ctx.setCookies.push(sessionCookie(ctx.sessionId));
}

export function registerAccountRoutes(): void {
  route('POST', '/api/accounts', 'api', async (ctx) => {
    const errors = new FieldErrors();
    const name = (readString(ctx.body, 'name') ?? '').trim();
    const email = (readString(ctx.body, 'email') ?? '').trim().toLowerCase();
    const password = readString(ctx.body, 'password') ?? '';
    if (name.length < 1 || name.length > 80) errors.add('name', FIELD_COPY.name);
    if (!EMAIL_PATTERN.test(email)) errors.add('email', FIELD_COPY.email);
    if (password.length < 10) errors.add('password', FIELD_COPY.password);
    errors.throwIfAny();

    const existing = await db.one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (existing !== null) throw emailTaken();

    const id = randomUUID();
    await db.query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [
      id,
      name,
      email,
      hashPassword(password),
      'customer'
    ]);
    await attachSession(ctx, id);
    sendJson(ctx, 201, { user: { id, name, email, role: 'customer' } });
  });

  route('POST', '/api/session', 'api', async (ctx) => {
    const email = (readString(ctx.body, 'email') ?? '').trim().toLowerCase();
    const password = readString(ctx.body, 'password') ?? '';
    const user = await db.one<{ id: string; name: string; email: string; role: string; password_hash: string }>(
      'SELECT id, name, email, role, password_hash FROM users WHERE email = $1',
      [email]
    );
    if (user === null || !verifyPassword(password, user.password_hash)) throw invalidCredentials();
    await attachSession(ctx, user.id);
    sendJson(ctx, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  route('DELETE', '/api/session', 'api', async (ctx) => {
    await db.query('UPDATE sessions SET user_id = NULL WHERE id = $1', [ctx.sessionId]);
    ctx.response.writeHead(204, { 'Set-Cookie': sessionCookie(ctx.sessionId) });
    ctx.response.end();
  });

  route('GET', '/api/me', 'api', async (ctx) => {
    sendJson(ctx, 200, { user: ctx.user });
  });

  route('GET', '/api/addresses', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await db.query(
      `SELECT id, label, name, line1, line2, city, state, postcode, phone FROM addresses
       WHERE user_id = $1 AND deleted = false ORDER BY position ASC, created_at ASC`,
      [user.id]
    );
    sendJson(ctx, 200, rows);
  });

  route('POST', '/api/addresses', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const errors = new FieldErrors();
    const label = (readString(ctx.body, 'label') ?? '').trim();
    if (label.length < 1 || label.length > 30) errors.add('label', FIELD_COPY.label);
    const address = validateAddress(ctx.body, errors, '');
    errors.throwIfAny();
    const id = randomUUID();
    await db.query(
      `INSERT INTO addresses (id, user_id, label, name, line1, line2, city, state, postcode, phone, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               (SELECT coalesce(max(position), 0) + 1 FROM addresses WHERE user_id = $2))`,
      [
        id,
        user.id,
        label,
        address.name,
        address.line1,
        address.line2,
        address.city,
        address.state,
        address.postcode,
        address.phone
      ]
    );
    sendJson(ctx, 201, { id, label, ...address });
  });

  route('DELETE', '/api/addresses/:id', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const row = await db.one<{ id: string }>(
      'SELECT id FROM addresses WHERE id::text = $1 AND user_id = $2 AND deleted = false',
      [ctx.params.id, user.id]
    );
    if (row === null) throw notFound();
    await db.query('UPDATE addresses SET deleted = true WHERE id = $1', [row.id]);
    ctx.response.writeHead(204);
    ctx.response.end();
  });

  route('GET', '/api/wishlist', 'api', async (ctx) => {
    sendJson(ctx, 200, await loadWishlist(db, { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null }));
  });

  route('PUT', '/api/wishlist/:slug', 'api', async (ctx) => {
    const view = await tx(async (client) => {
      const product = await client.one<{ id: string }>(
        "SELECT id FROM products WHERE slug = $1 AND status = 'published'",
        [ctx.params.slug]
      );
      if (product === null) throw notFound();
      const owner = { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null };
      const wishlistId = await ensureWishlist(client, owner);
      await client.query(
        `INSERT INTO wishlist_items (wishlist_id, product_id) VALUES ($1, $2)
         ON CONFLICT (wishlist_id, product_id) DO NOTHING`,
        [wishlistId, product.id]
      );
      const wishlist = await loadWishlist(client, owner);
      await publishWishlist(client, owner.userId, wishlist.count, wishlist.items.map((item) => item.slug));
      return wishlist;
    });
    sendJson(ctx, 200, view);
  });

  route('DELETE', '/api/wishlist/:slug', 'api', async (ctx) => {
    const view = await tx(async (client) => {
      const owner = { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null };
      const wishlistId = await ensureWishlist(client, owner);
      await client.query(
        `DELETE FROM wishlist_items WHERE wishlist_id = $1
         AND product_id IN (SELECT id FROM products WHERE slug = $2)`,
        [wishlistId, ctx.params.slug]
      );
      const wishlist = await loadWishlist(client, owner);
      await publishWishlist(client, owner.userId, wishlist.count, wishlist.items.map((item) => item.slug));
      return wishlist;
    });
    sendJson(ctx, 200, view);
  });

  route('GET', '/api/notifications', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await db.query<{ id: string; text: string; at: Date; email_status: string }>(
      'SELECT id, text, at, email_status FROM notifications WHERE user_id = $1 ORDER BY at DESC, id DESC',
      [user.id]
    );
    sendJson(
      ctx,
      200,
      rows.map((row) => ({
        id: row.id,
        text: row.text,
        at: row.at.toISOString(),
        email_status: row.email_status
      }))
    );
  });

  route('GET', '/api/gift-cards/:code', 'api', async (ctx) => {
    requireUser(ctx);
    if (!(await giftCardExists(db, ctx.params.code))) throw notFound();
    sendJson(ctx, 200, {
      last4: giftCardLast4(ctx.params.code),
      balance: await giftCardBalance(db, ctx.params.code)
    });
  });
}

export { ensureWishlist };

export function validateEmailField(value: string, errors: FieldErrors, key: string): void {
  if (!EMAIL_PATTERN.test(value)) errors.add(key, FIELD_COPY.email);
}
