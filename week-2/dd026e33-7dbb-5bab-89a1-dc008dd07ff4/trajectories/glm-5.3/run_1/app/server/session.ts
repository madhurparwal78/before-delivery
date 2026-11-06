import { randomBytes } from 'node:crypto';
import type { Db, Tx } from './db.ts';
import { ERRORS, ApiError } from './errors.ts';
import { verifyPassword } from './password.ts';
import { isSafeReturnAddress, ROLE_HOME } from './domain/redirect.ts';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SessionState {
  user: SessionUser;
  sessionId: string;
}

export interface SessionCheckResult {
  user: SessionUser;
  sessionId: string;
  ended: null | 'revoked' | 'expired' | 'signed_out';
}

export async function createSession(db: Db, userId: string, lifetimeSeconds: number): Promise<string> {
  const id = randomBytes(24).toString('hex');
  const endsAt = new Date(Date.now() + lifetimeSeconds * 1000).toISOString();
  await db.query(
    'INSERT INTO sessions (id, user_id, created_at, ends_at) VALUES ($1,$2,now(),$3)',
    [id, userId, endsAt],
  );
  return id;
}

export async function findUserByEmail(db: Db, email: string): Promise<(SessionUser & { passwordHash: string; active: boolean }) | null> {
  const rows = await db.query<{ id: string; name: string; email: string; role: string; password_hash: string; active: boolean }>(
    'SELECT id, name, email, role, password_hash, active FROM users WHERE email = $1',
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, passwordHash: row.password_hash, active: row.active };
}

export async function checkSession(db: Db, sessionId: string): Promise<SessionCheckResult | null> {
  const rows = await db.query<{
    id: string; user_id: string; name: string; email: string; role: string;
    ends_at: string; end_reason: string | null; active: boolean;
  }>(
    `SELECT s.id, s.user_id, s.ends_at, s.end_reason, u.name, u.email, u.role, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  const user: SessionUser = { id: row.user_id, name: row.name, email: row.email, role: row.role };
  if (row.end_reason === 'revoked' || !row.active) {
    return { user, sessionId: row.id, ended: 'revoked' };
  }
  if (Date.now() >= Date.parse(row.ends_at)) {
    return { user, sessionId: row.id, ended: 'expired' };
  }
  if (row.end_reason === 'signed_out') {
    return { user, sessionId: row.id, ended: 'signed_out' };
  }
  return { user, sessionId: row.id, ended: null };
}

export function sessionEndedError(ended: 'revoked' | 'expired' | 'signed_out'): ApiError {
  if (ended === 'revoked') return ERRORS.accessRevoked();
  if (ended === 'expired') return ERRORS.sessionExpired();
  return ERRORS.unauthenticated();
}

export async function signIn(
  db: Db,
  email: string,
  password: string,
  next: string | undefined,
  lifetimeSeconds: number,
): Promise<{ user: SessionUser; sessionId: string; redirect: string }> {
  const found = await findUserByEmail(db, email);
  if (!found || !verifyPassword(password, found.passwordHash)) {
    throw ERRORS.invalidCredentials();
  }
  if (!found.active) {
    throw ERRORS.invalidCredentials();
  }
  const sessionId = await createSession(db, found.id, lifetimeSeconds);
  await db.query('UPDATE users SET last_sign_in_at = now() WHERE id = $1', [found.id]);
  const redirect = isSafeReturnAddress(next) ? decodeURIComponent(next as string) : ROLE_HOME[found.role];
  return {
    user: { id: found.id, name: found.name, email: found.email, role: found.role },
    sessionId,
    redirect,
  };
}

export async function signOut(db: Db, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET end_reason = 'signed_out'
     WHERE id = $1 AND end_reason IS NULL`,
    [sessionId],
  );
}

export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET end_reason = 'revoked'
     WHERE user_id = $1 AND end_reason IS NULL`,
    [userId],
  );
}
