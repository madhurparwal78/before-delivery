import { randomBytes } from 'node:crypto';
import { now } from './clock.js';
import { query, queryOne } from './db.js';
import { fail } from './errors.js';
import type { Ctx, Role, Session } from './http.js';

export const SESSION_COOKIE = 'tf_session';
export const GUEST_CART_COOKIE = 'tf_cart';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export async function loadSession(sessionId: string | undefined): Promise<Session | null> {
  if (!sessionId) return null;
  const row = await queryOne<{ id: string; user_id: string; email: string; role: string }>(
    `SELECT s.id, s.user_id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  if (!row) return null;
  return { sessionId: row.id, userId: Number(row.user_id), email: row.email, role: row.role as Role };
}

export async function startSession(ctx: Ctx, userId: number): Promise<string> {
  const id = randomToken(32);
  await query('INSERT INTO sessions (id, user_id, created_at) VALUES ($1, $2, $3)', [id, userId, now()]);
  ctx.setCookie(SESSION_COOKIE, id, SESSION_MAX_AGE_SECONDS);
  return id;
}

export async function endSession(ctx: Ctx, sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  ctx.clearCookie(SESSION_COOKIE);
}

export async function endOtherSessions(userId: number, keepSessionId: string | null): Promise<void> {
  if (keepSessionId) await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, keepSessionId]);
  else await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export function requireSession(ctx: Ctx): Session {
  if (!ctx.session) fail('unauthorized');
  return ctx.session;
}

export function requireCustomer(ctx: Ctx): Session {
  const session = requireSession(ctx);
  if (session.role !== 'customer') fail('forbidden');
  return session;
}

export function requireStaff(ctx: Ctx, roles: Role[]): Session {
  const session = requireSession(ctx);
  if (!roles.includes(session.role)) fail('forbidden');
  return session;
}

/** The caller's cart: one account cart for a customer, otherwise a guest cart under its own cookie. */
export async function resolveCartId(ctx: Ctx): Promise<number> {
  if (ctx.session && ctx.session.role === 'customer') {
    const existing = await queryOne<{ id: string }>('SELECT id FROM carts WHERE user_id = $1', [ctx.session.userId]);
    if (existing) return Number(existing.id);
    const created = await queryOne<{ id: string }>(
      'INSERT INTO carts (user_id, created_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id',
      [ctx.session.userId, now()],
    );
    return Number(created?.id);
  }

  const token = ctx.cookies[GUEST_CART_COOKIE];
  if (token) {
    const existing = await queryOne<{ id: string }>('SELECT id FROM carts WHERE guest_token = $1', [token]);
    if (existing) return Number(existing.id);
  }
  const fresh = token ?? randomToken(18);
  ctx.setCookie(GUEST_CART_COOKIE, fresh, SESSION_MAX_AGE_SECONDS);
  const created = await queryOne<{ id: string }>(
    'INSERT INTO carts (guest_token, created_at) VALUES ($1, $2) ON CONFLICT (guest_token) DO UPDATE SET guest_token = EXCLUDED.guest_token RETURNING id',
    [fresh, now()],
  );
  return Number(created?.id);
}

export async function guestCartId(ctx: Ctx): Promise<number | null> {
  const token = ctx.cookies[GUEST_CART_COOKIE];
  if (!token) return null;
  const row = await queryOne<{ id: string }>('SELECT id FROM carts WHERE guest_token = $1', [token]);
  return row ? Number(row.id) : null;
}

export async function accountCartId(userId: number): Promise<number> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM carts WHERE user_id = $1', [userId]);
  if (existing) return Number(existing.id);
  const created = await queryOne<{ id: string }>(
    'INSERT INTO carts (user_id, created_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id',
    [userId, now()],
  );
  return Number(created?.id);
}

