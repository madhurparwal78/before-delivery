import { pool, query } from './db.js';
import { PRESENCE_TIMEOUT_SECONDS } from '../shared/constants.js';

export const COPY_ID = `${process.pid}-${Date.now()}`;

export async function clearStaleConnections(): Promise<void> {
  await pool.query(
    `DELETE FROM realtime_connections
     WHERE copy_id = $1 OR last_heartbeat < now() - make_interval(secs => $2)`,
    [COPY_ID, PRESENCE_TIMEOUT_SECONDS],
  );
}

export async function registerConnection(id: string, accountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO realtime_connections (id, account_id, copy_id) VALUES ($1, $2, $3)`,
    [id, accountId, COPY_ID],
  );
}

export async function heartbeat(id: string): Promise<void> {
  await pool.query('UPDATE realtime_connections SET last_heartbeat = now() WHERE id = $1', [id]);
}

export async function setJoinedSession(id: string, sessionId: string | null): Promise<void> {
  await pool.query('UPDATE realtime_connections SET joined_session_id = $1 WHERE id = $2', [
    sessionId,
    id,
  ]);
}

export async function closeConnection(id: string): Promise<void> {
  await pool.query('DELETE FROM realtime_connections WHERE id = $1', [id]);
}

/**
 * Decides the account's presence now and records it. Returns the new presence only when it changed,
 * so exactly one caller (on any copy) announces each change.
 */
export async function settlePresence(accountId: string): Promise<'online' | 'offline' | null> {
  const online = await isOnline(accountId);
  const rows = await query<{ id: string }>(
    `UPDATE accounts SET presence_announced = $2
     WHERE id = $1 AND presence_announced IS DISTINCT FROM $2 RETURNING id`,
    [accountId, online],
  );
  if (rows.length === 0) return null;
  return online ? 'online' : 'offline';
}

/** Accounts announced online whose last heartbeat or last connection is gone. */
export async function lapsedPresence(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT a.id FROM accounts a
     WHERE a.presence_announced AND NOT EXISTS (
       SELECT 1 FROM realtime_connections c
       WHERE c.account_id = a.id AND c.last_heartbeat > now() - make_interval(secs => $1)
     )`,
    [PRESENCE_TIMEOUT_SECONDS],
  );
  return rows.map((row) => row.id);
}

/** An account is online while one of its connections has a heartbeat inside the window. */
async function isOnline(accountId: string): Promise<boolean> {
  const rows = await query<{ online: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM realtime_connections
       WHERE account_id = $1 AND last_heartbeat > now() - make_interval(secs => $2)
     ) AS online`,
    [accountId, PRESENCE_TIMEOUT_SECONDS],
  );
  return rows[0].online;
}

export async function onlineAmong(accountIds: readonly string[]): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const rows = await query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM realtime_connections
     WHERE account_id = ANY($1::uuid[]) AND last_heartbeat > now() - make_interval(secs => $2)`,
    [accountIds as string[], PRESENCE_TIMEOUT_SECONDS],
  );
  return new Set(rows.map((row) => row.account_id));
}

/** Accounts holding at least one realtime connection that joined this session. */
export async function accountsInSession(sessionId: string): Promise<Set<string>> {
  const rows = await query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM realtime_connections
     WHERE joined_session_id = $1 AND last_heartbeat > now() - make_interval(secs => $2)`,
    [sessionId, PRESENCE_TIMEOUT_SECONDS],
  );
  return new Set(rows.map((row) => row.account_id));
}
