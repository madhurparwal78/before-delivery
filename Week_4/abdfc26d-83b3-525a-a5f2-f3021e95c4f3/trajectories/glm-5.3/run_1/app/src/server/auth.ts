import type { IncomingMessage } from 'node:http';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import type { User } from '../types.js';
import { one } from './db.js';

export interface SessionInfo {
  user: User | null;
}

const BEARER = /^Bearer (.+)$/;

async function introspectToken(token: string): Promise<User | null> {
  try {
    const res = await fetch(`${config.authIssuerUrl || `${config.keycloakUrl}/realms/${config.keycloakRealm}`}/protocol/openid-connect/token/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token,
        client_id: config.authClientId,
        client_secret: config.authClientSecret
      }).toString()
    });
    if (!res.ok) return null;
    const data = await res.json() as { active?: boolean; sub?: string; preferred_username?: string; email?: string; name?: string; realm_access?: { roles?: string[] } };
    if (!data.active || !data.sub) return null;
    return {
      id: data.sub,
      username: data.preferred_username ?? '',
      display_name: data.name ?? data.preferred_username ?? '',
      email: data.email ?? '',
      roles: data.realm_access?.roles ?? []
    };
  } catch {
    return null;
  }
}

export async function currentUser(req: IncomingMessage): Promise<User | null> {
  const auth = req.headers.authorization;
  if (auth && BEARER.test(auth)) {
    return introspectToken(auth.match(BEARER)?.[1] ?? '');
  }
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/(?:^|;\s*)py_session=([^;]+)/);
  if (!match) return null;
  let token: string;
  try {
    token = Buffer.from(decodeURIComponent(match[1]), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const row = await one<{ id: string; username: string; display_name: string; email: string; roles: string[] }>(
    `SELECT id, username, display_name, email, roles FROM users WHERE id = $1`,
    [token]
  );
  if (!row) return null;
  return { id: row.id, username: row.username, display_name: row.display_name, email: row.email, roles: row.roles };
}

export async function requireUser(req: IncomingMessage): Promise<User> {
  const user = await currentUser(req);
  if (!user) throw AppError.unauthenticated();
  return user;
}

export function requireRole(user: User, role: 'creator' | 'collector' | 'founder-operator'): void {
  if (!user.roles.includes(role)) throw AppError.forbidden();
}

export async function ensureLocalUser(user: User): Promise<void> {
  await one(
    `INSERT INTO users (id, username, display_name, email, roles) VALUES ($1,$2,$3,$4,string_to_array($5, ','))
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email`,
    [user.id, user.username, user.display_name, user.email, user.roles.join(',')]
  );
}

export function sessionCookie(userId: string): string {
  const value = encodeURIComponent(Buffer.from(userId, 'utf8').toString('base64url'));
  return `py_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
}

export function clearSessionCookie(): string {
  return 'py_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
