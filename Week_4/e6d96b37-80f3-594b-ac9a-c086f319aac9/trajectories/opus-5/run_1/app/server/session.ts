import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { limits } from './config.ts';
import { db, type Sql } from './providers/db.ts';
import { KeycloakDown, isIdentityLive } from './providers/keycloak.ts';
import { clearCookie, readCookies, setCookie } from './http/request.ts';
import { authenticationRequired, serviceUnavailable } from './http/errors.ts';
import { namespaceNow } from './domain/clock.ts';
import type { Role } from '../shared/types.ts';

export const SESSION_COOKIE = 'flan_session';

export interface AppSession {
  id: string;
  ns: string;
  subject: string;
  username: string;
  role: Role;
  kcSession: string | null;
  stepUpAt: Date | null;
  expiresAt: Date;
  bypassKeycloak: boolean;
}

interface SessionRow {
  id: string;
  ns: string;
  subject: string;
  username: string;
  role: string;
  kc_session: string | null;
  step_up_at: Date | null;
  expires_at: Date;
  bypass_keycloak: boolean;
}

function toSession(row: SessionRow): AppSession {
  return {
    id: row.id,
    ns: row.ns,
    subject: row.subject,
    username: row.username,
    role: row.role as Role,
    kcSession: row.kc_session,
    stepUpAt: row.step_up_at,
    expiresAt: row.expires_at,
    bypassKeycloak: row.bypass_keycloak,
  };
}

/** The realm roles decide the desk role; anyone else is an outsider. */
export function roleFromRealmRoles(realmRoles: string[]): Role {
  if (realmRoles.includes('flan-dealer')) return 'dealer';
  if (realmRoles.includes('flan-counterpart')) return 'counterpart';
  return 'outsider';
}

export async function createSession(
  sql: Sql,
  init: {
    ns: string;
    subject: string;
    username: string;
    role: Role;
    kcSession: string | null;
    stepUpAt: Date | null;
    bypassKeycloak?: boolean;
  },
): Promise<AppSession> {
  const id = randomBytes(32).toString('base64url');
  const now = await namespaceNow(sql, init.ns);
  const expiresAt = new Date(now.getTime() + limits.sessionTtlS * 1000);
  await sql.query(
    `INSERT INTO app_sessions
       (id, ns, subject, username, role, kc_session, created_at, expires_at, step_up_at, bypass_keycloak)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      init.ns,
      init.subject,
      init.username,
      init.role,
      init.kcSession,
      now,
      expiresAt,
      init.stepUpAt,
      init.bypassKeycloak ?? false,
    ],
  );
  return {
    id,
    ns: init.ns,
    subject: init.subject,
    username: init.username,
    role: init.role,
    kcSession: init.kcSession,
    stepUpAt: init.stepUpAt,
    expiresAt,
    bypassKeycloak: init.bypassKeycloak ?? false,
  };
}

export async function loadSession(id: string): Promise<AppSession | null> {
  const sql = await db();
  const found = await sql.query<SessionRow>(
    `SELECT id, ns, subject, username, role, kc_session, step_up_at, expires_at, bypass_keycloak
       FROM app_sessions WHERE id = $1`,
    [id],
  );
  const row = found.rows[0];
  return row ? toSession(row) : null;
}

export async function recordStepUp(sessionId: string, at: Date): Promise<void> {
  const sql = await db();
  await sql.query('UPDATE app_sessions SET step_up_at = $2 WHERE id = $1', [sessionId, at]);
}

export async function destroySession(sessionId: string): Promise<void> {
  const sql = await db();
  await sql.query('DELETE FROM app_sessions WHERE id = $1', [sessionId]);
}

/** Every session of a subject ends when their identity is revoked. */
export async function destroySessionsOfSubject(subject: string): Promise<void> {
  const sql = await db();
  await sql.query('DELETE FROM app_sessions WHERE subject = $1', [subject]);
}

export function attachSessionCookie(response: ServerResponse, session: AppSession): void {
  setCookie(response, SESSION_COOKIE, session.id, limits.sessionTtlS);
}

export function detachSessionCookie(response: ServerResponse): void {
  clearCookie(response, SESSION_COOKIE);
}

export function sessionIdOf(request: IncomingMessage): string | null {
  return readCookies(request)[SESSION_COOKIE] ?? null;
}

/**
 * A step-up proof is fresh for FLAN_STEPUP_TTL_S of real time after Keycloak's
 * authentication time.
 */
export function stepUpFresh(session: AppSession, realNow = new Date()): boolean {
  if (!session.stepUpAt) return false;
  return realNow.getTime() - session.stepUpAt.getTime() < limits.stepUpTtlS * 1000;
}

export function stepUpExpiresAt(session: AppSession): string | null {
  if (!session.stepUpAt) return null;
  return new Date(session.stepUpAt.getTime() + limits.stepUpTtlS * 1000).toISOString();
}

/**
 * Resolves the caller. A session past its namespace-clock lifetime, or whose
 * Keycloak account has been disabled or signed out, grants nothing.
 */
export async function resolveSession(request: IncomingMessage): Promise<AppSession | null> {
  const id = sessionIdOf(request);
  if (!id) return null;
  const session = await loadSession(id);
  if (!session) return null;

  const now = await namespaceNow(await db(), session.ns);
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  return session;
}

/**
 * Every write re-checks that the Keycloak account is enabled and its session
 * active, so no queued or resumed command succeeds after a revocation.
 */
export async function assertIdentityLive(session: AppSession): Promise<void> {
  if (session.bypassKeycloak) return;
  let live: boolean;
  try {
    live = await isIdentityLive(session.subject, session.kcSession);
  } catch (error) {
    if (error instanceof KeycloakDown) throw serviceUnavailable();
    throw error;
  }
  if (!live) {
    await destroySessionsOfSubject(session.subject);
    throw authenticationRequired();
  }
}
