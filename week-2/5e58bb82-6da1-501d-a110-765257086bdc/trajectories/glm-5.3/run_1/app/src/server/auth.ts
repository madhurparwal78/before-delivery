import type pg from 'pg';
import { config } from './config.js';
import { apiError, randomToken, sha256Hex } from './http.js';

export type Role = 'principal_surveyor' | 'launch_technician' | 'client_reviewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  client_org_id: string | null;
  units: 'metric' | 'imperial';
}

export interface SessionUser extends User {
  session_expires_at: Date;
}

const SCREEN_STAFF = new Set(['/fleet', '/missions', '/launch', '/flags']);
const SCREEN_PREFIXES_STAFF = ['/fleet/', '/missions/', '/fleet'];
const MISSION_SCREEN_PREFIXES = ['/missions/'];
const SCREEN_CLIENT = new Set(['/surveys']);
const SCREEN_PRINCIPAL = new Set(['/missions/new']);

export function roleHome(role: Role): string {
  if (role === 'principal_surveyor') return '/fleet';
  if (role === 'launch_technician') return '/launch';
  return '/surveys';
}

export function decodeOnce(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function isSafePath(path: string, user: { role: Role; client_org_id: string | null }): boolean {
  if (!path.startsWith('/')) return false;
  if (path.length > 1 && (path[1] === '/' || path[1] === '\\')) return false;
  const decoded = decodeOnce(path);
  if (!decoded.startsWith('/')) return false;
  if (decoded.length > 1 && (decoded[1] === '/' || decoded[1] === '\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(decoded)) return false;
  const pathPart = decoded.split('?')[0]!;
  if (pathPart === '/sign-in' || pathPart === '/api/me' || pathPart.startsWith('/api/')) return false;
  if (user.role === 'principal_surveyor') {
    if (SCREEN_STAFF.has(pathPart) || SCREEN_PRINCIPAL.has(pathPart)) return true;
    if (pathPart.startsWith('/fleet/') || pathPart.startsWith('/missions/')) return true;
    return false;
  }
  if (user.role === 'launch_technician') {
    if (SCREEN_STAFF.has(pathPart) && pathPart !== '/missions/new') return true;
    if (pathPart.startsWith('/fleet/') || pathPart.startsWith('/missions/')) return true;
    return false;
  }
  // client reviewer
  if (SCREEN_CLIENT.has(pathPart)) return true;
  if (pathPart.startsWith('/surveys/')) return true;
  return false;
}

export function parseCookie(req: { headers: Record<string, unknown> }): string | null {
  const raw = req.headers['cookie'];
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'swathdeck_session') return rest.join('=');
  }
  return null;
}

export async function currentSession(c: pg.PoolClient, req: { headers: Record<string, unknown> }): Promise<SessionUser | null> {
  const token = parseCookie(req);
  if (!token) return null;
  const hash = sha256Hex(token);
  const r = await c.query(
    `SELECT u.id, u.name, u.email, u.role, u.client_org_id, u.units, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.revoked = false AND s.expires_at > now()`,
    [hash]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0]!;
  return {
    id: row.id, name: row.name, email: row.email,
    role: row.role as Role, client_org_id: row.client_org_id,
    units: row.units as 'metric' | 'imperial',
    session_expires_at: new Date(row.expires_at),
  };
}

export async function requireSession(c: pg.PoolClient, req: { headers: Record<string, unknown> }): Promise<SessionUser> {
  const u = await currentSession(c, req);
  if (!u) throw apiError(401, 'unauthenticated', 'Sign in to continue');
  return u;
}

export async function createSession(c: pg.PoolClient, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 12 * 3600 * 1000);
  await c.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`, [sha256Hex(token), userId, expiresAt]);
  return { token, expiresAt };
}

export function sessionCookieHeader(token: string, expiresAt: Date): string {
  return `swathdeck_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

const LOCK_WINDOW_MS = config.signInWindowSeconds * 1000;

export async function checkSignInLimit(c: pg.PoolClient, email: string): Promise<void> {
  const key = email.trim().toLowerCase();
  const r = await c.query(
    `SELECT count, window_start, lock_until FROM sign_in_attempts WHERE email = $1 FOR UPDATE`,
    [key]
  );
  const now = Date.now();
  let row = r.rows[0] as { count: number; window_start: string; lock_until: string | null } | undefined;
  if (!row) {
    await c.query(`INSERT INTO sign_in_attempts (email, count, window_start) VALUES ($1, 0, $2)`, [key, new Date(now)]);
    row = { count: 0, window_start: new Date(now).toISOString(), lock_until: null };
  }
  if (row.lock_until && new Date(row.lock_until).getTime() > now) {
    const retryAt = new Date(row.lock_until);
    throw apiError(429, 'too_many_attempts', `Too many sign-in attempts. Try again after ${fmtHHMM(retryAt)} UTC.`, { retry_at: toIsoWholeSeconds(retryAt) });
  }
}

export function toIsoWholeSeconds(d: Date): string {
  const t = new Date(Math.floor(d.getTime() / 1000) * 1000);
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fmtHHMM(d: Date): string {
  return d.toISOString().slice(11, 16);
}

export function tooManyAttemptsError(retryAt: Date): ApiErrorLike {
  return {
    status: 429,
    body: { error: 'too_many_attempts', message: `Too many sign-in attempts. Try again after ${fmtHHMM(retryAt)} UTC.`, retry_at: toIsoWholeSeconds(retryAt) },
    headers: { 'Retry-After': String(Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000))) },
  };
}

export interface ApiErrorLike { status: number; body: unknown; headers?: Record<string, string> }

export async function recordSignInFailure(c: pg.PoolClient, email: string): Promise<ApiErrorLike | null> {
  const key = email.trim().toLowerCase();
  const now = Date.now();
  await c.query(`
    INSERT INTO sign_in_attempts (email, count, window_start) VALUES ($1, 0, $2)
    ON CONFLICT (email) DO NOTHING`, [key, new Date(now)]);
  const r = await c.query(
    `SELECT count, window_start, lock_until FROM sign_in_attempts WHERE email = $1 FOR UPDATE`,
    [key]
  );
  const row = r.rows[0] as { count: number; window_start: Date; lock_until: Date | null };
  const ws = new Date(row.window_start).getTime();
  let count = row.count;
  let windowStart = ws;
  if (now - ws >= LOCK_WINDOW_MS) {
    count = 0;
    windowStart = now;
  }
  count += 1;
  const lockUntil: Date | null = row.lock_until && new Date(row.lock_until).getTime() > now ? new Date(row.lock_until) : null;
  if (count >= 5) {
    // The failure that reaches the lock still answers 401; the lock applies from the next attempt.
    await c.query(`UPDATE sign_in_attempts SET count = $2, window_start = $3, lock_until = $4 WHERE email = $1`,
      [key, 5, new Date(windowStart), new Date(now + LOCK_WINDOW_MS)]);
    return null;
  }
  await c.query(`UPDATE sign_in_attempts SET count = $2, window_start = $3, lock_until = $4 WHERE email = $1`,
    [key, count, new Date(windowStart), lockUntil]);
  return null;
}

export async function resetSignInCount(c: pg.PoolClient, email: string): Promise<void> {
  await c.query(`UPDATE sign_in_attempts SET count = 0, lock_until = NULL WHERE email = $1`, [email.trim().toLowerCase()]);
}

export async function landingAddress(c: pg.PoolClient, user: User, next: string | undefined): Promise<string> {
  if (next !== undefined) {
    if (isSafePath(next, user)) return next;
    return roleHome(user.role);
  }
  const r = await c.query(`SELECT last_screen FROM users WHERE id = $1`, [user.id]);
  const last = r.rows[0]?.last_screen as string | null;
  if (last && isSafePath(last, user)) {
    // mission/survey/vessel liveness checks
    if (last.startsWith('/missions/')) {
      const id = last.split('/')[2]!.split('?')[0];
      const m = await c.query(`SELECT id FROM missions WHERE id = $1`, [id]);
      if (m.rows.length === 0) return roleHome(user.role);
      if (user.role === 'client_reviewer') {
        const org = await c.query(`SELECT client_org_id FROM missions WHERE id = $1`, [id]);
        if (org.rows[0]?.client_org_id !== user.client_org_id) return roleHome(user.role);
      } else {
        const st = await c.query(`SELECT status FROM missions WHERE id = $1`, [id]);
        if (!['Planned', 'Launched', 'Surveying', 'Recovering'].includes(st.rows[0]?.status)) return roleHome(user.role);
      }
    }
    if (last.startsWith('/fleet/')) {
      const id = last.split('/')[2]!.split('?')[0];
      const v = await c.query(`SELECT id FROM vessels WHERE id = $1`, [id]);
      if (v.rows.length === 0) return roleHome(user.role);
    }
    if (last.startsWith('/surveys/')) {
      const id = last.split('/')[2]!.split('?')[0];
      const m = await c.query(`SELECT client_org_id FROM missions WHERE id = $1`, [id]);
      if (m.rows.length === 0 || m.rows[0]!.client_org_id !== user.client_org_id) return roleHome(user.role);
    }
    return last;
  }
  return roleHome(user.role);
}

export function userProjection(u: User): Record<string, unknown> {
  return { id: u.id, name: u.name, email: u.email, role: u.role, client_org_id: u.client_org_id, units: u.units };
}
