import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../env.js';
import { query } from '../db/pool.js';
import { ensureClientRole, verifyAccessToken, type TokenClaims } from '../services/keycloak.js';
import { SEED_USERS, type AppRole } from '../../shared/seed.js';
import { ApiError, sessionExpired, unauthenticated } from './errors.js';

export const SESSION_COOKIE = 'sp_session';
export const LOGIN_COOKIE = 'sp_login';

export interface AppUser {
  id: string;
  keycloakSub: string;
  email: string;
  name: string;
  roles: AppRole[];
}

export interface Caller {
  user: AppUser;
  sessionId: string | null;
}

interface CookieOptions {
  maxAgeSeconds?: number;
}

/** Session and sign-in cookies are httpOnly and SameSite=Lax. */
export function setCookie(
  res: Response,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  res.cookie(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.publicUrl.startsWith('https://'),
    path: '/',
    ...(options.maxAgeSeconds === undefined ? {} : { maxAge: options.maxAgeSeconds * 1000 }),
  });
}

export function clearCookie(res: Response, name: string): void {
  res.clearCookie(name, { httpOnly: true, sameSite: 'lax', path: '/' });
}

function displayName(email: string, fallback: string): string {
  const seeded = SEED_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  return seeded ? seeded.name : fallback;
}

interface UserRow {
  id: string;
  keycloak_sub: string;
  email: string;
  name: string;
  roles: string[];
}

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    keycloakSub: row.keycloak_sub,
    email: row.email,
    name: row.name,
    roles: row.roles as AppRole[],
  };
}

/**
 * Record the signed-in account. A first-time self-registered user, holding none
 * of the four roles, is given the client role.
 */
export async function upsertUserFromClaims(claims: TokenClaims): Promise<AppUser> {
  let roles = claims.roles;
  if (roles.length === 0) {
    await ensureClientRole(claims.sub).catch(() => undefined);
    roles = ['client'];
  }
  const name = displayName(claims.email, claims.name);
  const result = await query<UserRow>(
    `INSERT INTO app_users (id, keycloak_sub, email, name, roles)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (keycloak_sub) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           roles = CASE
             WHEN array_length(EXCLUDED.roles, 1) IS NULL THEN app_users.roles
             ELSE EXCLUDED.roles
           END
     RETURNING id, keycloak_sub, email, name, roles`,
    [randomUUID(), claims.sub, claims.email, name, roles],
  );
  const row = result.rows[0];
  if (!row) throw new Error('user upsert produced no row');
  return toAppUser(row);
}

export async function createSession(
  userId: string,
  accessToken: string,
  refreshToken: string,
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO sessions (id, user_id, access_token, refresh_token, access_expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [id, userId, accessToken, refreshToken, String(env.accessTtlSeconds)],
  );
  return id;
}

interface SessionRow extends UserRow {
  session_id: string;
  expired: boolean;
  refresh_token: string;
}

async function loadSession(sessionId: string): Promise<SessionRow | null> {
  const result = await query<SessionRow>(
    `SELECT s.id AS session_id,
            s.refresh_token,
            (s.access_expires_at <= now()) AS expired,
            u.id, u.keycloak_sub, u.email, u.name, u.roles
       FROM sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

export async function refreshSessionRow(
  sessionId: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await query(
    `UPDATE sessions
        SET access_token = $2,
            refresh_token = $3,
            access_expires_at = now() + ($4 || ' seconds')::interval
      WHERE id = $1`,
    [sessionId, accessToken, refreshToken, String(env.accessTtlSeconds)],
  );
}

export async function sessionRefreshToken(sessionId: string): Promise<string | null> {
  const row = await loadSession(sessionId);
  return row?.refresh_token ?? null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/**
 * Resolve the caller from the app session cookie or a bearer token. A session
 * whose access has lapsed answers session_expired, so the browser can refresh
 * once and replay the original request.
 */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const claims = await verifyAccessToken(header.slice(7).trim());
    if (!claims) return null;
    return { user: await upsertUserFromClaims(claims), sessionId: null };
  }
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return null;
  const row = await loadSession(sessionId);
  if (!row) return null;
  if (row.expired) throw sessionExpired();
  return { user: toAppUser(row), sessionId: row.session_id };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/** Require a signed-in caller; throws in the published precedence order. */
export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await resolveCaller(req);
  if (!caller) throw unauthenticated();
  return caller;
}

export function requireRole(caller: Caller, ...roles: AppRole[]): void {
  if (!roles.some((role) => caller.user.roles.includes(role))) {
    throw new ApiError(403, 'forbidden');
  }
}

export function hasRole(caller: Caller, role: AppRole): boolean {
  return caller.user.roles.includes(role);
}

export function isProducer(caller: Caller): boolean {
  return hasRole(caller, 'producer');
}

