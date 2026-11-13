/** Session records: refresh sessions and short-lived access tokens. */

import { config } from './config.js';
import { one, query } from './db.js';
import { newToken } from './domain/identity.js';
import type { Role } from '../shared/types.js';

export type SessionAccount = {
  accountId: string;
  sessionId: string;
  role: Role;
  name: string;
};

export async function createSession(accountId: string): Promise<{ sessionId: string; accessId: string }> {
  const sessionId = newToken();
  const accessId = newToken();
  await query(
    `INSERT INTO sessions (id, account_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [sessionId, accountId, String(config.sessionTtlSeconds)],
  );
  await query(
    `INSERT INTO access_tokens (id, session_id, account_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [accessId, sessionId, accountId, String(config.accessTtlSeconds)],
  );
  return { sessionId, accessId };
}

export async function resolveAccess(accessId: string): Promise<SessionAccount | null> {
  const row = await one<{
    account_id: string;
    session_id: string;
    role: Role;
    name: string;
  }>(
    `SELECT t.account_id, t.session_id, a.role, a.name
       FROM access_tokens t
       JOIN accounts a ON a.id = t.account_id
       JOIN sessions s ON s.id = t.session_id
      WHERE t.id = $1 AND t.expires_at > now() AND s.expires_at > now()`,
    [accessId],
  );
  if (row === null) return null;
  return {
    accountId: row.account_id,
    sessionId: row.session_id,
    role: row.role,
    name: row.name,
  };
}

export async function refreshAccess(sessionId: string): Promise<string | null> {
  const session = await one<{ account_id: string }>(
    `SELECT account_id FROM sessions WHERE id = $1 AND expires_at > now()`,
    [sessionId],
  );
  if (session === null) return null;
  const accessId = newToken();
  await query(
    `INSERT INTO access_tokens (id, session_id, account_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [accessId, sessionId, session.account_id, String(config.accessTtlSeconds)],
  );
  return accessId;
}

export async function destroySession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}


export async function destroyAllSessions(accountId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE account_id = $1', [accountId]);
}
