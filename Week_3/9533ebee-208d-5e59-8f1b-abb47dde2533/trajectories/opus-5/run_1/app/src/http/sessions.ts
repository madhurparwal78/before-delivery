/**
 * Member sessions. A token is an opaque random string stored in Postgres, so
 * it is valid in every server process, and it does not expire.
 */

import { randomBytes } from 'node:crypto';
import { query, writeInstant } from '../db/pool.ts';
import { isRole, ROLES, type Role } from '../domain/roles.ts';
import { unauthenticated } from './problem.ts';

export { isRole, ROLES };
export type { Role };

export interface Member {
  readonly actorId: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export async function createSession(actorId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO sessions (token, actor_id, created_at) VALUES ($1, $2, $3)', [
    token,
    actorId,
    writeInstant(Date.now()),
  ]);
  return token;
}

/** The member a bearer token belongs to, or null when it is unknown. */
export async function memberForToken(token: string): Promise<Member | null> {
  const result = await query<{ actor_id: string; name: string; email: string; role: string }>(
    `SELECT a.actor_id, a.name, a.email, a.role
     FROM sessions s JOIN actors a ON a.actor_id = s.actor_id
     WHERE s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { actorId: row.actor_id, name: row.name, email: row.email, role: row.role as Role };
}

/** Reads the bearer token, refusing a missing or malformed header. */
export function bearerToken(header: string | undefined): string {
  if (header === undefined) throw unauthenticated();
  const match = /^Bearer[ ]+(\S+)$/.exec(header.trim());
  const token = match?.[1];
  if (token === undefined) throw unauthenticated();
  return token;
}
