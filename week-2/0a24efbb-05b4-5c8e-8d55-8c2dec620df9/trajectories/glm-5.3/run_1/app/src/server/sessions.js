import { randomBytes, createHash } from 'node:crypto';
import { query } from '../db/pg.js';
import { config } from '../server/config.js';

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export const SESSION_COOKIE = 'rostara_session';

/**
 * Create a fresh session for a person. The caller's presented session, if any,
 * is ended by the caller.
 */
export async function createSession(personId) {
  const token = newToken();
  await query(
    `INSERT INTO desk_session (token_hash, person_id, created_at, last_used_at)
     VALUES ($1, $2, now(), now())`,
    [hashToken(token), personId]
  );
  return token;
}

export async function endSessionByToken(token) {
  if (!token) return;
  await query(
    `UPDATE desk_session SET ended_at = now(), ended_reason = 'signed_out'
     WHERE token_hash = $1 AND ended_at IS NULL`,
    [hashToken(token)]
  );
}

/** Load a live session: not ended, not expired, person active. Returns {session, person} or a refusal kind. */
export async function loadSession(token) {
  if (!token) return null;
  const rows = await query(
    `SELECT s.id, s.token_hash, s.created_at, s.last_used_at, s.ended_at, s.ended_reason,
            p.id AS person_id, p.name, p.work_address, p.role, p.active
     FROM desk_session s JOIN person p ON p.id = s.person_id
     WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  if (rows.length === 0) return { kind: 'unknown' };
  const row = rows[0];
  // a session ended by signing out counts as no session at all
  if (row.ended_at) {
    return row.ended_reason === 'signed_out' ? { kind: 'unknown' } : { kind: 'ended' };
  }
  const now = Date.now();
  const idleLimit = config.sessionIdleSeconds * 1000;
  const maxLimit = config.sessionMaxSeconds * 1000;
  if (now - row.last_used_at.getTime() >= idleLimit) return { kind: 'ended' };
  if (now - row.created_at.getTime() >= maxLimit) return { kind: 'ended' };
  if (!row.active) return { kind: 'ended' };
  return {
    kind: 'ok',
    session: row,
    person: {
      id: row.person_id,
      name: row.name,
      work_address: row.work_address,
      role: row.role,
      active: row.active,
    },
  };
}

/** Refresh the session's last use, never beyond its absolute limit. */
export async function touchSession(sessionId) {
  await query('UPDATE desk_session SET last_used_at = now() WHERE id = $1', [sessionId]);
}
