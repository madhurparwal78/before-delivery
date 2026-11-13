import type { Client } from '../db/pool.js';
import { Router } from 'express';
import { h } from './h.js';
import { pool, withClient, inTransaction } from '../db/pool.js';
import { Errors, rupeeText, digitGroup } from '../domain/errors.js';
import { hashPassword, verifyPassword } from '../domain/password.js';
import { readSession, setSessionCookie, requireSignedIn, SESSION_COOKIE, attachSession, type SessionInfo } from './session.js';
import { publish } from '../domain/events.js';
import { availableFor } from '../domain/ledger.js';
import { computeTotals, type CartLineInput } from '../domain/totals.js';
import { CONFIG } from '../config.js';

export const accountRouter = Router();

// --- accounts ---------------------------------------------------------------

accountRouter.post('/accounts', h(async (req, res) => {
  const body = req.body as { name?: unknown; email?: unknown; password?: unknown };
  const fields = validateRegistration(body);
  if (fields) throw Errors.validationFailed(fields);
  const created = await inTransaction(async (client) => {
    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [String(body.email).toLowerCase()]);
    if (existing.rows.length > 0) throw Errors.emailTaken();
    const result = await client.query<{ id: string; name: string; email: string; role: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'customer') RETURNING id::TEXT AS id, name, email, role`,
      [String(body.name), String(body.email).toLowerCase(), hashPassword(String(body.password))]);
    return result.rows[0];
  });
  const session = await readSession(req, res);
  await inTransaction(async (client) => {
    await client.query(`UPDATE sessions SET user_id = $1 WHERE token = $2`, [Number(created.id), session.token]);
  });
  res.status(201).json({ user: { id: Number(created.id), name: created.name, email: created.email, role: created.role } });
}));

function validateRegistration(body: { name?: unknown; email?: unknown; password?: unknown }): Record<string, string> | null {
  const fields: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 80) fields.name = 'Enter your name in 1 to 80 characters.';
  const email = typeof body.email === 'string' ? body.email : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter an email address like name@example.com.';
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10) fields.password = 'Use a password of at least 10 characters.';
  return Object.keys(fields).length > 0 ? fields : null;
}

accountRouter.post('/session', h(async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fields: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter an email address like name@example.com.';
  if (password.length < 1) fields.password = 'Enter your password.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

  const user = await withClient(async (client) => {
    const res = await client.query<{ id: string; name: string; email: string; role: string; password_hash: string }>(
      `SELECT id::TEXT AS id, name, email, role, password_hash FROM users WHERE email = $1`, [email]);
    return res.rows[0] ?? null;
  });
  if (user === null || !verifyPassword(password, user.password_hash)) throw Errors.invalidCredentials();

  const session = await readSession(req, res);
  await inTransaction(async (client) => {
    await mergeGuestIntoAccount(client, session.token, Number(user.id));
    await client.query(`UPDATE sessions SET user_id = $1 WHERE token = $2`, [Number(user.id), session.token]);
  });
  setSessionCookie(res, session.token);
  res.status(200).json({ user: { id: Number(user.id), name: user.name, email: user.email, role: user.role } });
}));

/** Union wishlists, add bag quantities, empty the guest copies. */
export async function mergeGuestIntoAccount(client: Client, guestToken: string, userId: number): Promise<void> {
  const accountSession = await client.query<{ token: string }>(
    `SELECT token FROM sessions WHERE user_id = $1 ORDER BY created_at, token LIMIT 1`, [userId]);
  if (accountSession.rows.length === 0) {
    await client.query(`UPDATE sessions SET user_id = $1 WHERE token = $2`, [userId, guestToken]);
    return;
  }
  const accountToken = accountSession.rows[0].token;
  // Wishlist union into the account's canonical session, guest copies emptied.
  await client.query(
    `INSERT INTO wishlist_items (session_token, product_slug, saved_at)
     SELECT $1, product_slug, saved_at FROM wishlist_items WHERE session_token = $2
     ON CONFLICT (session_token, product_slug) DO NOTHING`,
    [accountToken, guestToken]);
  await client.query(`DELETE FROM wishlist_items WHERE session_token = $1`, [guestToken]);
  // Bag quantities added then clamped, guest copies emptied.
  const guestCart = await client.query<{ id: string }>(`SELECT id::TEXT AS id FROM carts WHERE session_token = $1`, [guestToken]);
  const accountCart = await client.query<{ id: string }>(`SELECT id::TEXT AS id FROM carts WHERE session_token = $1`, [accountToken]);
  if (guestCart.rows.length > 0) {
    if (accountCart.rows.length === 0) {
      await client.query(`UPDATE carts SET session_token = $1, user_id = $2 WHERE session_token = $3`, [accountToken, userId, guestToken]);
    } else {
      const guestLines = await client.query<{ sku: string; quantity: number }>(
        `SELECT sku, quantity FROM cart_lines WHERE cart_id = $1`, [Number(guestCart.rows[0].id)]);
      for (const line of guestLines.rows) {
        await client.query(
          `INSERT INTO cart_lines (cart_id, sku, quantity) VALUES ($1,$2,$3)
           ON CONFLICT (cart_id, sku) DO UPDATE SET quantity = LEAST(cart_lines.quantity + EXCLUDED.quantity, 10)`,
          [Number(accountCart.rows[0].id), line.sku, line.quantity]);
      }
      await client.query(`DELETE FROM carts WHERE session_token = $1`, [guestToken]);
    }
  }
  // The guest token joins the account so this browser stays signed in.
  await client.query(`UPDATE sessions SET user_id = $1 WHERE token = $2`, [userId, guestToken]);
}

/** A signed-in user's wishlist and bag live on their canonical session. */
export async function canonicalToken(client: Client, session: SessionInfo): Promise<string> {
  if (session.userId === null) return session.token;
  const res = await client.query<{ token: string }>(
    `SELECT token FROM sessions WHERE user_id = $1 ORDER BY created_at, token LIMIT 1`, [session.userId]);
  return res.rows[0]?.token ?? session.token;
}

accountRouter.delete('/session', h(async (req, res) => {
  const session = await readSession(req, res);
  await pool.query(`UPDATE sessions SET user_id = NULL WHERE token = $1`, [session.token]);
  res.status(204).send();
}));

accountRouter.get('/me', h(async (req, res) => {
  const session = await readSession(req, res);
  if (session.userId === null) {
    res.status(200).json({ user: null });
    return;
  }
  const user = await pool.query(`SELECT id, name, email, role FROM users WHERE id = $1`, [session.userId]);
  res.status(200).json({ user: user.rows[0] ?? null });
}));

// --- addresses --------------------------------------------------------------

accountRouter.get('/addresses', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const rows = await pool.query(
    `SELECT id, label, name, line1, line2, city, state, postcode, phone FROM addresses WHERE user_id = $1 ORDER BY id`, [userId]);
  res.status(200).json(rows.rows);
}));

accountRouter.post('/addresses', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const body = req.body as Record<string, unknown>;
  const fields = validateAddress(body);
  if (fields) throw Errors.validationFailed(fields);
  const row = await pool.query(
    `INSERT INTO addresses (user_id, label, name, line1, line2, city, state, postcode, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, label, name, line1, line2, city, state, postcode, phone`,
    [userId, String(body.label), String(body.name), String(body.line1), String(body.line2 ?? ''), String(body.city), String(body.state), String(body.postcode), String(body.phone)]);
  res.status(201).json(row.rows[0]);
}));

export function validateAddress(body: Record<string, unknown>): Record<string, string> | null {
  const fields: Record<string, string> = {};
  const name = str(body.name);
  if (name.length < 1) fields['name'] = 'Enter the recipient\'s full name.';
  const line1 = str(body.line1);
  if (line1.length < 1) fields['line1'] = 'Enter the first line of the address.';
  const line2 = str(body.line2);
  if (line2.length > 100) fields['line2'] = 'Keep address line 2 to 100 characters or fewer.';
  const city = str(body.city);
  if (city.length < 1) fields['city'] = 'Enter a town or city.';
  const state = str(body.state);
  if (state.length < 1) fields['state'] = 'Choose a state.';
  const postcode = str(body.postcode);
  if (!/^[1-9][0-9]{5}$/.test(postcode)) fields['postcode'] = 'Enter a 6-digit PIN code.';
  const phone = str(body.phone);
  if (!/^[1-9][0-9]{9}$/.test(phone)) fields['phone'] = 'Enter a 10-digit mobile number.';
  const label = str(body.label);
  if (label.length < 1 || label.length > 30) fields['label'] = 'Give the address a label of 1 to 30 characters.';
  return Object.keys(fields).length > 0 ? fields : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// --- wishlist ---------------------------------------------------------------

accountRouter.get('/wishlist', h(async (req, res) => {
  const session = await readSession(req, res);
  const token = await withClient((client) => canonicalToken(client, session));
  const rows = await pool.query<{ product_slug: string; name: string; saved_at: Date }>(
    `SELECT w.product_slug, p.name, w.saved_at FROM wishlist_items w
     JOIN products p ON p.slug = w.product_slug WHERE w.session_token = $1 ORDER BY w.saved_at DESC, w.product_slug`,
    [token]);
  const items = rows.rows.map((r) => ({ slug: r.product_slug, name: r.name, saved_at: r.saved_at.toISOString() }));
  res.status(200).json({ count: items.length, items });
}));

accountRouter.put('/wishlist/:slug', h(async (req, res) => {
  const session = await readSession(req, res);
  const slug = req.params.slug;
  const token = await withClient((client) => canonicalToken(client, session));
  await inTransaction(async (client) => {
    const product = await client.query(`SELECT slug FROM products WHERE slug = $1 AND status = 'published'`, [slug]);
    if (product.rows.length === 0) throw Errors.notFound();
    await client.query(
      `INSERT INTO wishlist_items (session_token, product_slug) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [token, slug]);
    await publishWishlist(client, { ...session, token });
  });
  const rows = await pool.query(`SELECT product_slug FROM wishlist_items WHERE session_token = $1`, [token]);
  res.status(200).json({ count: rows.rows.length, items: rows.rows.map((r) => ({ slug: r.product_slug })) });
}));

accountRouter.delete('/wishlist/:slug', h(async (req, res) => {
  const session = await readSession(req, res);
  const slug = req.params.slug;
  const token = await withClient((client) => canonicalToken(client, session));
  await inTransaction(async (client) => {
    await client.query(`DELETE FROM wishlist_items WHERE session_token = $1 AND product_slug = $2`, [token, slug]);
    await publishWishlist(client, { ...session, token });
  });
  const rows = await pool.query(`SELECT product_slug FROM wishlist_items WHERE session_token = $1`, [token]);
  res.status(200).json({ count: rows.rows.length, items: rows.rows.map((r) => ({ slug: r.product_slug })) });
}));

async function publishWishlist(client: Client, session: SessionInfo): Promise<void> {
  const rows = await client.query<{ product_slug: string }>(
    `SELECT product_slug FROM wishlist_items WHERE session_token = $1`, [session.token]);
  await publish(client, 'wishlist', { count: rows.rows.length, slugs: rows.rows.map((r) => r.product_slug) },
    { userId: session.userId, sessionId: session.token, staffVisible: false });
}

// --- notifications ----------------------------------------------------------

accountRouter.get('/notifications', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const rows = await pool.query(
    `SELECT id, text, at, email_status FROM notifications WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT 50`, [userId]);
  res.status(200).json(rows.rows.map((r) => ({
    id: Number(r.id), text: r.text, at: (r.at as Date).toISOString(), email_status: r.email_status,
  })));
}));

// --- gift card lookup (customer) --------------------------------------------

accountRouter.get('/gift-cards/:code', h(async (req, res) => {
  const session = await readSession(req, res);
  requireSignedIn(session);
  const code = req.params.code.toUpperCase();
  const balance = await giftCardBalance(code);
  if (balance === null) throw Errors.notFound();
  res.status(200).json({ last4: code.slice(-4), balance });
}));

export async function giftCardBalance(code: string): Promise<number | null> {
  const res = await pool.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0)::TEXT AS balance FROM gift_card_ledger WHERE code = $1`, [code]);
  if (res.rows.length === 0) return null;
  const card = await pool.query(`SELECT code FROM gift_cards WHERE code = $1`, [code]);
  if (card.rows.length === 0) return null;
  return Number(res.rows[0].balance);
}
