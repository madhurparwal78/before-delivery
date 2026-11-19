import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool, type Db } from './db.js';
import { Err } from './errors.js';
import type { Ctx } from './http.js';
import type { Role } from '../shared/types.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
}

export interface Membership {
  setId: string;
  role: Role;
  user: AuthUser;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = newSessionToken();
  await db.query(
    `insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '30 days')`,
    [token, userId],
  );
  return token;
}

export async function currentUser(ctx: Ctx): Promise<AuthUser | null> {
  const token = ctx.cookies['ag_session'];
  if (token === undefined) return null;
  const result = await pool.query<AuthUser>(
    `select u.id, u.email, u.display_name
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function requireUser(ctx: Ctx): Promise<AuthUser> {
  const user = await currentUser(ctx);
  if (user === null) throw Err.unauthenticated();
  return user;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** An unknown set, or one the caller is not a member of, is a 404. */
export async function requireMembership(ctx: Ctx, setId: string): Promise<Membership> {
  const user = await requireUser(ctx);
  if (!isUuid(setId)) throw Err.notFound();
  const result = await pool.query<{ role: Role }>(
    `select role from set_members where set_id = $1 and user_id = $2`,
    [setId, user.id],
  );
  const row = result.rows[0];
  if (row === undefined) throw Err.notFound();
  return { setId, role: row.role, user };
}

export function requireEditor(membership: Membership): Membership {
  if (membership.role === 'viewer') throw Err.forbidden();
  return membership;
}

export function requireOwner(membership: Membership): Membership {
  if (membership.role !== 'owner') throw Err.forbidden();
  return membership;
}
