import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../../shared/types';
import { newId, newToken, pool, type Queryable } from '../db';
import { env } from '../env';

export const SESSION_COOKIE = 'ed_session';

const SCRYPT_KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface Principal {
  memberId: string;
  name: string;
  email: string;
  role: Role;
  workspaceId: string;
  workspaceName: string;
  timeZone: string;
}

export async function createSession(memberId: string): Promise<string> {
  const token = newToken();
  await pool.query('INSERT INTO sessions (token, member_id, last_seen_at) VALUES ($1, $2, now())', [
    token,
    memberId,
  ]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function resolveSession(token: string): Promise<Principal | null> {
  const { rows } = await pool.query<{
    member_id: string;
    name: string;
    email: string;
    role: Role;
    workspace_id: string;
    workspace_name: string;
    time_zone: string;
    idle_seconds: string;
  }>(
    `SELECT members.id AS member_id, members.name, members.email, members.role,
            workspaces.id AS workspace_id, workspaces.name AS workspace_name, workspaces.time_zone,
            EXTRACT(EPOCH FROM (now() - sessions.last_seen_at)) AS idle_seconds
       FROM sessions
       JOIN members ON members.id = sessions.member_id
       JOIN workspaces ON workspaces.id = members.workspace_id
      WHERE sessions.token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  if (Number(row.idle_seconds) > env.sessionIdleSeconds) {
    await destroySession(token);
    return null;
  }
  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token = $1', [token]);
  return {
    memberId: row.member_id,
    name: row.name,
    email: row.email,
    role: row.role,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    timeZone: row.time_zone,
  };
}

export async function recordAudit(
  db: Queryable,
  workspaceId: string,
  memberId: string | null,
  action: string,
  entity: string,
  entityId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (id, workspace_id, member_id, action, entity, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [newId(), workspaceId, memberId, action, entity, entityId, JSON.stringify(detail)],
  );
}
