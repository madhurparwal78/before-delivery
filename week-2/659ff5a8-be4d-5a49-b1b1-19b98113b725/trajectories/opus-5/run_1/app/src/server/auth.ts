import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from './db/pool';
import type { ClubRole, SessionUser } from '../shared/api';

export const SESSION_COOKIE = 'paddock_session';

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(digest, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface AccountRow {
  id: string;
  club_id: string | null;
  name: string;
  email: string;
  password_hash: string;
  roles: string[];
}

export interface ClubRow {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  roles: string[];
  club: ClubRow | null;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [
    tokenHash(token),
    userId,
  ]);
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
}

export async function actorForToken(token: string): Promise<Actor | null> {
  const row = await queryOne<{
    id: string;
    name: string;
    email: string;
    roles: string[];
    club_id: string | null;
    club_slug: string | null;
    club_name: string | null;
    club_time_zone: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.roles, u.club_id,
            c.slug AS club_slug, c.name AS club_name, c.time_zone AS club_time_zone
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN clubs c ON c.id = u.club_id
      WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  if (!row) return null;
  const club =
    row.club_id && row.club_slug && row.club_name && row.club_time_zone
      ? { id: row.club_id, slug: row.club_slug, name: row.club_name, time_zone: row.club_time_zone }
      : null;
  return { id: row.id, name: row.name, email: row.email, roles: row.roles, club };
}

export function sessionUser(actor: Actor): SessionUser {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    roles: actor.roles,
    club: actor.club
      ? { slug: actor.club.slug, name: actor.club.name, timeZone: actor.club.time_zone }
      : null,
  };
}

export function isOperator(actor: Actor): boolean {
  return actor.roles.includes('operator');
}

/** The chair may do everything the timing chief and worker chief may. */
export function hasClubRole(actor: Actor, ...roles: ClubRole[]): boolean {
  if (actor.roles.includes('chair')) return true;
  return roles.some((role) => actor.roles.includes(role));
}

export async function createUser(input: {
  clubId: string | null;
  name: string;
  email: string;
  password: string;
  roles: string[];
}): Promise<AccountRow> {
  const id = randomUUID();
  const rows = await query<AccountRow>(
    `INSERT INTO users (id, club_id, name, email, password_hash, roles)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, club_id, name, email, password_hash, roles`,
    [id, input.clubId, input.name, input.email, hashPassword(input.password), input.roles],
  );
  const created = rows[0];
  if (!created) throw new Error('User insert returned no row');
  return created;
}

export async function findAccountByEmail(email: string): Promise<AccountRow | null> {
  return queryOne<AccountRow>(
    `SELECT id, club_id, name, email, password_hash, roles
       FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
}
