import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Role } from '../../shared/protocol.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'gandyboard_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 32);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, digest] = stored.split('$');
  if (!salt || !digest) return false;
  const derived = await scryptAsync(password, salt, 32);
  const expected = Buffer.from(digest, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface SignedInUser {
  id: string;
  email: string;
  display_name: string;
  walkthrough_done: boolean;
}

export interface Membership {
  workspace_id: string;
  workspace_name: string;
  role: Role;
}

export async function findUserByEmail(email: string): Promise<
  (SignedInUser & { password_hash: string }) | null
> {
  const { rows } = await pool.query<SignedInUser & { password_hash: string }>(
    `select id, email, display_name, walkthrough_done, password_hash
     from users where lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

export async function startAuthSession(userId: string): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await pool.query(`insert into auth_sessions (id, user_id) values ($1, $2)`, [id, userId]);
  return id;
}

export async function endAuthSession(id: string): Promise<void> {
  await pool.query(`delete from auth_sessions where id = $1`, [id]);
}

/** Renews the idle period and returns the signed-in person, or null once it has ended. */
export async function resolveAuthSession(id: string): Promise<SignedInUser | null> {
  const { rows } = await pool.query<SignedInUser>(
    `update auth_sessions set last_seen_at = now()
     where id = $1 and last_seen_at > now() - ($2 || ' seconds')::interval
     returning (select u.id from users u where u.id = auth_sessions.user_id) as id,
               (select u.email from users u where u.id = auth_sessions.user_id) as email,
               (select u.display_name from users u where u.id = auth_sessions.user_id) as display_name,
               (select u.walkthrough_done from users u where u.id = auth_sessions.user_id) as walkthrough_done`,
    [id, String(config.sessionIdleSeconds)],
  );
  return rows[0] ?? null;
}

export async function membershipsOf(userId: string): Promise<Membership[]> {
  const { rows } = await pool.query<Membership>(
    `select m.workspace_id, w.name as workspace_name, m.role
     from memberships m join workspaces w on w.id = m.workspace_id
     where m.user_id = $1 order by w.name`,
    [userId],
  );
  return rows;
}

export async function membershipIn(
  userId: string,
  workspaceId: string,
): Promise<Membership | null> {
  const { rows } = await pool.query<Membership>(
    `select m.workspace_id, w.name as workspace_name, m.role
     from memberships m join workspaces w on w.id = m.workspace_id
     where m.user_id = $1 and m.workspace_id = $2`,
    [userId, workspaceId],
  );
  return rows[0] ?? null;
}

export type Capability = 'read' | 'build' | 'manage' | 'operate' | 'found';

const CAPABILITIES: Record<Role, Capability[]> = {
  founder: ['read', 'build', 'manage', 'operate', 'found'],
  manager: ['read', 'build', 'manage', 'operate'],
  member: ['read', 'build'],
  operator: ['read', 'operate'],
};

export function roleAllows(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}
