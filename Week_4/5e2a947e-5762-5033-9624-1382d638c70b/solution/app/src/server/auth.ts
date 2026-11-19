import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../shared/errors.ts';
import { USERNAME_PATTERN } from '../shared/rules.ts';
import { serverNow, toIso } from './clock.ts';
import { config } from './config.ts';
import { database, query } from './db.ts';
import type { Ctx, Principal } from './http.ts';
import { randomId } from './ids.ts';

export const SESSION_COOKIE = 'sprig_session';
export const GUEST_COOKIE = 'sprig_guest';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** A salted slow hash, stored as `salt:hash` in base64. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${(await derive(password, salt)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt = '', hash = ''] = stored.split(':');
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

export async function findUser(username: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(database(), 'SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  return rows[0] ?? null;
}

/** Create an account; the unique username decides, at the write, who got there first. */
export async function createUser(username: string, password: string): Promise<UserRow> {
  const row = { id: randomId(), username, password_hash: await hashPassword(password) };
  try {
    await query(database(), 'INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)', [row.id, row.username, row.password_hash, toIso(serverNow())]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ApiError('username_taken', 'That username is taken.');
    throw error;
  }
  return row;
}

interface NewSession {
  token: string;
  expiresAt: number;
}

export async function createSession(userId: string): Promise<NewSession> {
  const token = randomBytes(32).toString('base64url');
  const now = serverNow();
  const expiresAt = now + config.sessionTtlMs;
  await query(database(), 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    hashToken(token),
    userId,
    toIso(now),
    toIso(expiresAt),
  ]);
  return { token, expiresAt };
}

/** Sign-out ends the session itself, so a copy of its cookie signs in nothing. */
export async function endSession(token: string): Promise<void> {
  await query(database(), 'DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export const sessionCookie = (name: string, token: string, maxAgeMs: number | null): string =>
  `${name}=${token}; HttpOnly; SameSite=Lax; Path=/${maxAgeMs === null ? '' : `; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`}`;

export const clearCookie = (name: string): string => `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

interface SessionRow {
  id: string;
  username: string;
  expires_at: Date;
}

interface GuestRow {
  id: string;
  display_name: string;
  map_id: string;
  role: 'editor' | 'commenter' | 'viewer';
  state: string;
  expires_at: Date | null;
}

export async function principalFromCookies(cookies: Record<string, string>): Promise<Principal | null> {
  const session = cookies[SESSION_COOKIE];
  if (session) {
    const rows = await query<SessionRow>(
      database(),
      'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [hashToken(session)],
    );
    const row = rows[0];
    if (row) {
      const expiresAt = row.expires_at.getTime();
      if (expiresAt <= serverNow()) throw new ApiError('session_expired', 'Your session ended. Sign in again to keep your changes.');
      return { id: row.id, name: row.username, guest: false, guestMap: null, guestRole: null, expiresAt };
    }
  }
  const guest = cookies[GUEST_COOKIE];
  if (guest) {
    const rows = await query<GuestRow>(
      database(),
      `SELECT g.id, g.display_name, g.map_id, g.role, l.state, l.expires_at
       FROM guest_sessions g JOIN share_links l ON l.id = g.link_id WHERE g.token_hash = $1`,
      [hashToken(guest)],
    );
    const row = rows[0];
    if (row) {
      if (row.state === 'revoked') throw new ApiError('link_revoked', "This link was turned off by the map's owner.");
      if (row.state === 'expired' || (row.expires_at && row.expires_at.getTime() <= serverNow())) {
        throw new ApiError('link_expired', 'This link has expired.');
      }
      return { id: `guest:${row.id}`, name: row.display_name, guest: true, guestMap: row.map_id, guestRole: row.role, expiresAt: null };
    }
  }
  return null;
}

/** The authenticate stage for routes that need a signed-in person or a guest. */
export async function requirePrincipal(ctx: Ctx): Promise<void> {
  const principal = await principalFromCookies(ctx.cookies);
  if (!principal) throw new ApiError('unauthenticated', 'Sign in to continue.');
  ctx.principal = principal;
}

/** The authenticate stage for routes only an account holder may use. */
export async function requireAccount(ctx: Ctx): Promise<Principal> {
  await requirePrincipal(ctx);
  const principal = ctx.principal;
  if (!principal || principal.guest) throw new ApiError('unauthenticated', 'Sign in to continue.');
  return principal;
}

export async function createGuestSession(mapId: string, linkId: string, displayName: string, role: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(
    database(),
    'INSERT INTO guest_sessions (token_hash, id, map_id, link_id, display_name, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [hashToken(token), randomId(), mapId, linkId, displayName, role, toIso(serverNow())],
  );
  return token;
}

export function validateCredentials(username: unknown, password: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    fields.username = 'Username must be 3 to 24 characters: lowercase letters, digits or underscores.';
  }
  if (typeof password !== 'string' || password.length < 8) fields.password = 'Password must be at least 8 characters.';
  return fields;
}

/** Sign-in attempts per username in a rolling minute of server time. */
const attempts = new Map<string, number[]>();
const MINUTE = 60_000;

export function noteLoginAttempt(username: string): void {
  const now = serverNow();
  const recent = (attempts.get(username) ?? []).filter((at) => now - at < MINUTE);
  if (recent.length >= config.loginRate) {
    const wait = Math.max(1, Math.ceil((MINUTE - (now - (recent[0] ?? now))) / 1000));
    throw new ApiError('rate_limited', 'Too many sign-in attempts. Try again in a minute.', { headers: { 'retry-after': String(wait) } });
  }
  recent.push(now);
  attempts.set(username, recent);
}

/** Operations per person in a rolling minute of server time. */
const operations = new Map<string, { at: number; count: number }[]>();

export function noteOperations(personId: string, count: number): void {
  const now = serverNow();
  const recent = (operations.get(personId) ?? []).filter((entry) => now - entry.at < MINUTE);
  const used = recent.reduce((sum, entry) => sum + entry.count, 0);
  if (used + count > config.opRate) {
    const wait = Math.max(1, Math.ceil((MINUTE - (now - (recent[0]?.at ?? now))) / 1000));
    throw new ApiError('rate_limited', 'Too many changes. Try again in a moment.', { headers: { 'retry-after': String(wait) } });
  }
  recent.push({ at: now, count });
  operations.set(personId, recent);
}
