import type pg from 'pg';
import type { Account } from '../shared/types.js';
import { now } from './clock.js';

export type SessionKind = 'account' | 'pending_join' | 'ended';

export interface SessionRow {
  id: string;
  token: string;
  accountId: string | null;
  kind: SessionKind;
  pendingClassroomId: string | null;
  endedReason: string | null;
}

// Read a session by cookie token. Ended sessions are returned as-is so the
// caller can answer with their ended reason; absent sessions are null.
export async function loadSession(pool: pg.Pool, token: string): Promise<SessionRow | null> {
  const { rows } = await pool.query('SELECT id, token, account_id, kind, pending_classroom_id, ended_reason FROM sessions WHERE token = $1', [token]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    accountId: row.account_id,
    kind: row.kind,
    pendingClassroomId: row.pending_classroom_id,
    endedReason: row.ended_reason,
  };
}

export async function accountById(pool: pg.Pool, id: string): Promise<Account | null> {
  const { rows } = await pool.query('SELECT id, kind, display_name, email, email_verified, classroom_id, nickname FROM accounts WHERE id = $1', [id]);
  return rowToAccount(rows[0]) ?? null;
}

export function rowToAccount(row: pg.QueryResultRow | undefined): Account | null {
  if (!row) return null;
  return {
    id: row.id as string,
    kind: row.kind as Account['kind'],
    displayName: row.display_name as string | null,
    email: row.email as string | null,
    emailVerified: row.email_verified as boolean,
    classroomId: row.classroom_id as string | null,
    nickname: row.nickname as string | null,
  };
}

export async function endSessionsForAccount(pool: pg.Pool, accountId: string, reason: string): Promise<void> {
  await pool.query(`UPDATE sessions SET kind = 'ended', ended_reason = $1, pending_classroom_id = NULL WHERE account_id = $2 AND kind != 'ended'`, [reason, accountId]);
}

export function serverNowIso(): string {
  return now().toISOString();
}
