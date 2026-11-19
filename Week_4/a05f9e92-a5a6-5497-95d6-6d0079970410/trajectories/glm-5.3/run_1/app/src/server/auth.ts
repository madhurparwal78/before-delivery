// Sessions, roles and the baseline access grants.

import { Db } from './db.js';
import { ApiError, unauthenticated } from './errors.js';
import type { Role } from '../shared/model.js';

export interface SessionUser {
  username: string;
  display_name: string;
  roles: Role[];
  department: string;
  time_zone: string;
  active: boolean;
  digest: 'immediate' | 'daily';
}

export interface Session {
  token: string;
  user: SessionUser;
  impersonating: SessionUser | null;
  workspace: 'live' | 'test';
}

export const ROLE_PRECEDENCE: Role[] = ['operator', 'technician', 'approver', 'manager', 'requester'];

export const HOME_SCREENS: Record<Role, string> = {
  operator: '/desk',
  technician: '/desk',
  approver: '/approve',
  manager: '/portal',
  requester: '/portal',
};

export function homeScreenFor(roles: Role[]): string {
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) return HOME_SCREENS[role];
  }
  return '/portal';
}

const COOKIE_NAME = 'switchyard_session';

export function readSessionCookie(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers.cookie;
  if (!raw || Array.isArray(raw)) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function setSessionCookie(res: { setHeader: (k: string, v: string | string[]) => void }, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(res: { setHeader: (k: string, v: string | string[]) => void }): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Load a session from its token. Returns null when unknown or the user is gone. */
export async function loadSession(db: Db, token: string): Promise<Session | null> {
  interface SessionRow {
    token: string; impersonating: string | null; workspace: string; username: string; display_name: string;
    roles: string[] | null; department: string | null; time_zone: string; digest: string; active: boolean;
  }
  const res = await db.query(
    `SELECT s.token, s.impersonating, s.workspace, p.username, p.display_name, p.roles, p.department, p.time_zone, p.digest, p.active
     FROM sessions s JOIN people p ON p.username = s.username
     WHERE s.token = $1`,
    [token],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0] as unknown as SessionRow;
  if (!row.active) return null;
  const user = toSessionUser(row);

  let impersonating: SessionUser | null = null;
  if (row.impersonating) {
    const target = await db.query(
      `SELECT username, display_name, roles, department, time_zone, digest, active FROM people WHERE username = $1`,
      [row.impersonating],
    );
    if (target.rows.length && (target.rows[0] as unknown as SessionRow).active) {
      impersonating = toSessionUser(target.rows[0] as unknown as SessionRow);
    }
  }

  return { token: row.token, user, impersonating, workspace: row.workspace === 'test' ? 'test' : 'live' };
}

function toSessionUser(row: {
  username: string; display_name: string; roles: string[] | null;
  department: string | null; time_zone: string; digest: string;
}): SessionUser {
  return {
    username: row.username,
    display_name: row.display_name,
    roles: (row.roles ?? []) as Role[],
    department: row.department ?? '',
    time_zone: row.time_zone,
    active: true,
    digest: row.digest === 'daily' ? 'daily' : 'immediate',
  };
}

/** The user whose roles decide permissions: the impersonated one when set. */
export function actingAs(session: Session): SessionUser {
  return session.impersonating ?? session.user;
}

export function requireSession(session: Session | null): Session {
  if (!session) throw unauthenticated();
  return session;
}
