import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db.js';
import { config } from '../config.js';
import { plusSeconds } from '../clock.js';

export const SESSION_COOKIE = 'saltreach_session';

export type SessionRecord = {
  id: string;
  accountId: number | null;
  csrfToken: string;
  expiresAt: Date;
};

type SessionDbRow = {
  id: string;
  account_id: number | null;
  csrf_token: string;
  expires_at: Date;
};

function mapSession(row: SessionDbRow): SessionRecord {
  return {
    id: row.id,
    accountId: row.account_id === null ? null : Number(row.account_id),
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at
  };
}

export async function createSession(
  client: Queryable,
  accountId: number | null,
  at: Date
): Promise<SessionRecord> {
  const id = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = plusSeconds(at, config.sessionSeconds);
  await client.query(
    `INSERT INTO sessions (id, account_id, csrf_token, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, accountId, csrfToken, at.toISOString(), expiresAt.toISOString()]
  );
  return { id, accountId, csrfToken, expiresAt };
}

export async function loadSession(
  client: Queryable,
  sessionId: string,
  at: Date
): Promise<SessionRecord | null> {
  const { rows } = await client.query<SessionDbRow>(
    `SELECT id, account_id, csrf_token, expires_at FROM sessions
      WHERE id = $1 AND ended_at IS NULL AND expires_at > $2`,
    [sessionId, at.toISOString()]
  );
  const row = rows[0];
  return row ? mapSession(row) : null;
}

export async function endSession(client: Queryable, sessionId: string, at: Date): Promise<void> {
  await client.query('UPDATE sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL', [
    sessionId,
    at.toISOString()
  ]);
}

export async function endAllSessionsOf(
  client: Queryable,
  accountId: number,
  at: Date
): Promise<void> {
  await client.query(
    'UPDATE sessions SET ended_at = $2 WHERE account_id = $1 AND ended_at IS NULL',
    [accountId, at.toISOString()]
  );
}

export function cookieHeader(sessionId: string): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${config.sessionSeconds}`
  ];
  if (config.publicUrl.startsWith('https:')) parts.push('Secure');
  return parts.join('; ');
}
