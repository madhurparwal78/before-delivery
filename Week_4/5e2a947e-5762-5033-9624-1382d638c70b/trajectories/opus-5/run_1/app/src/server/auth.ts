import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { copy } from '../shared/copy.js';
import { ApiError } from '../shared/errors.js';
import type { Role } from '../shared/types.js';
import { nowMs, now } from './clock.js';
import { db } from './db.js';
import type { RequestContext } from './http.js';
import { settings } from './settings.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'sprig_session';
export const GUEST_COOKIE = 'sprig_guest';

export interface Actor {
  key: string;
  name: string;
  kind: 'user' | 'guest';
  userId: string | null;
  guestId: string | null;
  guestMapId: string | null;
  guestLinkId: string | null;
  guestRole: Role | null;
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function cookieHeader(name: string, value: string, maxAgeMs: number): string {
  const seconds = Math.floor(maxAgeMs / 1000);
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}`;
}

export function clearCookieHeader(name: string): string {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function validateCredentials(username: unknown, password: unknown): void {
  const fields: Record<string, string> = {};
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    fields.username = copy.usernameField;
  }
  if (typeof password !== 'string' || password.length < 8) {
    fields.password = copy.passwordField;
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError('invalid', 'Check the highlighted fields.', { fields });
  }
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomUUID();
  const created = now();
  const expiresAt = new Date(nowMs() + settings.sessionTtlMs);
  await db.query(
    'insert into sessions (id, user_id, created_at, expires_at) values ($1, $2, $3, $4)',
    [id, userId, created, expiresAt],
  );
  return { id, expiresAt };
}

export interface SessionRow {
  id: string;
  user_id: string;
  username: string;
  expires_at: Date;
}

export async function sessionFor(ctx: RequestContext): Promise<SessionRow | null> {
  const id = ctx.cookies[SESSION_COOKIE];
  if (!id) return null;
  const result = await db.query<SessionRow>(
    `select s.id, s.user_id, u.username, s.expires_at
       from sessions s join users u on u.id = s.user_id
      where s.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function guestActor(ctx: RequestContext): Promise<Actor | null> {
  const id = ctx.cookies[GUEST_COOKIE];
  if (!id) return null;
  const result = await db.query<{
    id: string;
    map_id: string;
    link_id: string;
    display_name: string;
    role: Role;
    state: string;
  }>(
    `select g.id, g.map_id, g.link_id, g.display_name, g.role, l.state
       from guests g join share_links l on l.id = g.link_id
      where g.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    key: `g:${row.id}`,
    name: row.display_name,
    kind: 'guest',
    userId: null,
    guestId: row.id,
    guestMapId: row.map_id,
    guestLinkId: row.link_id,
    guestRole: row.state === 'active' ? row.role : null,
  };
}

export async function optionalActor(ctx: RequestContext): Promise<Actor | null> {
  const session = await sessionFor(ctx);
  if (session) {
    if (session.expires_at.getTime() <= nowMs()) {
      throw new ApiError('session_expired', copy.sessionDialogText);
    }
    return {
      key: session.username,
      name: session.username,
      kind: 'user',
      userId: session.user_id,
      guestId: null,
      guestMapId: null,
      guestLinkId: null,
      guestRole: null,
    };
  }
  return guestActor(ctx);
}

export async function requireActor(ctx: RequestContext): Promise<Actor> {
  const actor = await optionalActor(ctx);
  if (!actor) throw new ApiError('unauthenticated', 'Sign in to continue.');
  return actor;
}

export async function requireUser(ctx: RequestContext): Promise<Actor> {
  const actor = await requireActor(ctx);
  if (actor.kind !== 'user') throw new ApiError('unauthenticated', 'Sign in to continue.');
  return actor;
}

export async function checkLoginRate(username: string): Promise<void> {
  const since = new Date(nowMs() - 60000);
  const result = await db.query<{ count: string }>(
    'select count(*)::text as count from login_attempts where username = $1 and at > $2',
    [username, since],
  );
  if (Number(result.rows[0].count) >= settings.loginRate) {
    throw new ApiError('rate_limited', copy.rateLimited, { retryAfterSeconds: 60 });
  }
}

export async function recordLoginAttempt(username: string): Promise<void> {
  await db.query('insert into login_attempts (username, at) values ($1, $2)', [username, now()]);
}

export async function checkOpRate(actorKey: string, weight: number): Promise<void> {
  const since = new Date(nowMs() - 60000);
  const result = await db.query<{ total: string }>(
    'select coalesce(sum(weight), 0)::text as total from op_attempts where actor = $1 and at > $2',
    [actorKey, since],
  );
  if (Number(result.rows[0].total) + weight > settings.opRate) {
    throw new ApiError('rate_limited', 'Too many changes. Try again in a minute.', {
      retryAfterSeconds: 60,
    });
  }
  await db.query('insert into op_attempts (actor, at, weight) values ($1, $2, $3)', [
    actorKey,
    now(),
    weight,
  ]);
}
