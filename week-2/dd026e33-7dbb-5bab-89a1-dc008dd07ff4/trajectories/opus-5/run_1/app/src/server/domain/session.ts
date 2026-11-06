import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { query, queryOne } from '../db';
import { verifyPassword } from '../passwords';
import type { Role, User } from '../../shared/types';
import type { UnitSettings } from '../../shared/units';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  active: boolean;
  units_film: 'um' | 'mil';
  units_pressure: 'bar' | 'psi';
  units_distance: 'km' | 'mi';
}

export interface LiveSession {
  readonly sessionId: string;
  readonly user: User;
  readonly units: UnitSettings;
}

export type SessionLookup =
  | { readonly kind: 'live'; readonly session: LiveSession }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'none' };

function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function toUnits(row: UserRow): UnitSettings {
  return { film: row.units_film, pressure: row.units_pressure, distance: row.units_distance };
}

export async function lookupSession(sessionId: string | null): Promise<SessionLookup> {
  if (sessionId === null || sessionId === '') return { kind: 'none' };
  const row = await queryOne<
    UserRow & { ended_reason: string | null; expires_at: Date; session_id: string }
  >(
    `select s.id as session_id, s.ended_reason, s.expires_at, u.*
     from sessions s join users u on u.id = s.user_id
     where s.id = $1`,
    [sessionId],
  );
  if (row === null) return { kind: 'none' };
  if (row.ended_reason === 'revoked') return { kind: 'revoked' };
  if (row.ended_reason !== null) return { kind: 'none' };
  if (row.expires_at.getTime() <= Date.now()) return { kind: 'expired' };
  return {
    kind: 'live',
    session: { sessionId: row.session_id, user: toUser(row), units: toUnits(row) },
  };
}

export async function signIn(email: string, password: string): Promise<LiveSession | null> {
  const row = await queryOne<UserRow>('select * from users where lower(email) = lower($1)', [email]);
  if (row === null || !row.active) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  const sessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionLifetimeSeconds * 1000);
  await query(
    'insert into sessions (id, user_id, created_at, expires_at) values ($1,$2,$3,$4)',
    [sessionId, row.id, now, expiresAt],
  );
  await query('update users set last_sign_in_at = $2 where id = $1', [row.id, now]);
  return { sessionId, user: toUser(row), units: toUnits(row) };
}

export async function signOut(sessionId: string): Promise<void> {
  await query(
    "update sessions set ended_at = now(), ended_reason = 'signed_out' where id = $1 and ended_reason is null",
    [sessionId],
  );
}

/** Revoking a member ends every session that member holds. */
export async function endSessionsOf(userId: string): Promise<void> {
  await query(
    "update sessions set ended_at = now(), ended_reason = 'revoked' where user_id = $1 and ended_reason is null",
    [userId],
  );
}
