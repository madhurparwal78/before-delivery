import { randomBytes } from 'node:crypto';
import { one, query, rows } from './db.js';
import { sessionTokenVerifier, opaqueId } from './crypto.js';
import { config } from './config.js';
import { invalidCredentials, forbidden, rateLimited, twoStepRequired, unauthenticated } from './errors.js';
import type { Req } from './http.js';
import { parseCookies } from './http.js';

export interface SessionUser { id: string; email: string; name: string; operator: boolean }

export interface AuthState {
  session: {
    id: string; user_id: string; state: string; device: string;
    created_at: Date; last_seen_at: Date; pending_expires_at: Date | null;
    confirmed_until: Date | null; isPending: boolean; isCurrent: boolean;
  } | null;
  user: SessionUser | null;
}

export function newSessionToken(): string { return randomBytes(32).toString('base64url'); }

export function sessionCookie(token: string): string {
  return `fs_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `fs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Creates a session for the user: pending for enrolled two-step users, active otherwise. */
export async function createSession(userId: string, device: string, enrolled: boolean): Promise<{ id: string; token: string; pending: boolean }> {
  const token = newSessionToken();
  const id = opaqueId('s', 9);
  const pending = enrolled;
  await query(
    `INSERT INTO sessions (id, token_hash, user_id, state, device, pending_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, sessionTokenVerifier(token), userId, pending ? 'pending' : 'active', device, pending ? new Date(Date.now() + config.timing.twoStepPending * 1000) : null]
  );
  return { id, token, pending };
}

/** Replaces the pending session with a new active one, in one change. */
export async function promotePendingSession(oldSessionId: string, userId: string, device: string): Promise<{ id: string; token: string }> {
  const token = newSessionToken();
  const id = opaqueId('s', 9);
  await query(`UPDATE sessions SET state = 'ended', ended_at = now() WHERE id = $1`, [oldSessionId]);
  await query(
    `INSERT INTO sessions (id, token_hash, user_id, state, device) VALUES ($1,$2,$3,'active',$4)`,
    [id, sessionTokenVerifier(token), userId, device]
  );
  return { id, token };
}

/** Loads and refreshes the session named by the cookie. Enforces both lifetimes. */
export async function loadSession(req: Req): Promise<AuthState> {
  const cookies = parseCookies(req.headers['cookie']);
  const token = cookies['fs_session'];
  if (!token) return { session: null, user: null };
  const hash = sessionTokenVerifier(token);
  const s = await one<SessionRow>(
    `SELECT id, user_id, state, device, created_at, last_seen_at, pending_expires_at, confirmed_until
     FROM sessions WHERE token_hash = $1`, [hash]
  );
  if (!s || s.state !== 'active' && s.state !== 'pending') return { session: null, user: null };
  const now = Date.now();
  if (s.state === 'pending') {
    if (s.pending_expires_at && s.pending_expires_at.getTime() <= now) return { session: null, user: null };
    const user = await one<SessionUser>(`SELECT id, email, name, operator FROM users WHERE id = $1`, [s.user_id]);
    return { session: { ...s, isPending: true, isCurrent: true }, user: user ?? null };
  }
  const idleEnd = s.last_seen_at.getTime() + config.timing.sessionIdle * 1000;
  const absEnd = s.created_at.getTime() + config.timing.sessionLifetime * 1000;
  if (idleEnd <= now || absEnd <= now) {
    await query(`UPDATE sessions SET state = 'ended', ended_at = now() WHERE id = $1 AND state = 'active'`, [s.id]);
    return { session: null, user: null };
  }
  await query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [s.id]);
  const user = await one<SessionUser>(`SELECT id, email, name, operator FROM users WHERE id = $1`, [s.user_id]);
  if (!user) return { session: null, user: null };
  return { session: { ...s, last_seen_at: new Date(), isPending: false, isCurrent: true }, user };
}

interface SessionRow {
  id: string; user_id: string; state: string; device: string;
  created_at: Date; last_seen_at: Date; pending_expires_at: Date | null; confirmed_until: Date | null;
}

/** Resolves the session into the three possible outcomes for a JSON API request. */
export async function requireSession(req: Req): Promise<{ user: SessionUser; sessionId: string; confirmedUntil: Date | null }> {
  const { session, user } = await loadSession(req);
  if (!session || !user) throw unauthenticated();
  if (session.isPending) throw twoStepRequired();
  return { user, sessionId: session.id, confirmedUntil: session.confirmed_until };
}

/** Sign-in throttling: 5 failures per email within the window. */
export async function throttleCheck(emailLower: string): Promise<number | null> {
  const since = new Date(Date.now() - config.timing.signinWindow * 1000);
  const r = await rows<{ id: number; at: Date }>(
    `SELECT id, at FROM signin_failures WHERE email_lower = $1 AND at > $2 ORDER BY at ASC`, [emailLower, since]
  );
  if (r.length >= 5) {
    const oldest = r[r.length - 5];
    const retry = Math.ceil((oldest.at.getTime() + config.timing.signinWindow * 1000 - Date.now()) / 1000);
    return Math.max(1, retry);
  }
  return null;
}

export async function recordFailure(emailLower: string, kind: string): Promise<void> {
  await query(`INSERT INTO signin_failures (email_lower, kind) VALUES ($1,$2)`, [emailLower, kind]);
}

export async function clearFailures(emailLower: string): Promise<void> {
  await query(`DELETE FROM signin_failures WHERE email_lower = $1`, [emailLower]);
}

/** Membership lookup for a workspace path. */
export async function membership(wsSlug: string, userId: string): Promise<{ role: string } | null> {
  return one<{ role: string }>(`SELECT role FROM members WHERE workspace_slug = $1 AND user_id = $2`, [wsSlug, userId]);
}

export function deviceFrom(headers: Record<string, string>): string {
  const ua = headers['user-agent'] ?? '';
  return ua.slice(0, 80) || 'Unknown device';
}

export function requireRole(role: string | null, allowed: string[]): void {
  if (!role || !allowed.includes(role)) throw forbidden();
}

export { invalidCredentials, rateLimited };
