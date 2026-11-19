import type { DbPool } from './db.js';
import type { Storage } from './storage.js';
import type { Collab } from './collab.js';
import { errors } from './errors.js';

export interface Deps {
  pool: DbPool;
  storage: Storage;
  collab: Collab;
}

export interface Actor {
  id: string;
  email: string;
  display_name: string;
}

export type Role = 'owner' | 'editor' | 'viewer';

export const SESSION_COOKIE = 'ag_session';

export async function requireUser (deps: Deps, sessionId: string | undefined): Promise<Actor> {
  if (sessionId === undefined || sessionId === '') throw errors.unauthenticated();
  const result = await deps.pool.query(
    `SELECT u.id, u.email, u.display_name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0] as { id: string; email: string; display_name: string; expires_at: Date } | undefined;
  if (row === undefined || row.expires_at.getTime() < Date.now()) throw errors.unauthenticated();
  return { id: row.id, email: row.email, display_name: row.display_name };
}

export async function membership (deps: Deps, setId: string, userId: string): Promise<Role | null> {
  const result = await deps.pool.query('SELECT role FROM members WHERE set_id = $1 AND user_id = $2', [setId, userId]);
  if (result.rowCount === 0) return null;
  return result.rows[0].role as Role;
}

export async function requireMember (deps: Deps, setId: string, userId: string): Promise<Role> {
  const role = await membership(deps, setId, userId);
  if (role === null) throw errors.notFound();
  return role;
}

export function requireWrite (role: Role): void {
  if (role === 'viewer') throw errors.forbidden();
}

export function requireOwner (role: Role): void {
  if (role !== 'owner') throw errors.forbidden();
}
