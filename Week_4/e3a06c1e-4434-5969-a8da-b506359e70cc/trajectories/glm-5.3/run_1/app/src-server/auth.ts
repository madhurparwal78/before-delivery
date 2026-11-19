// Session cookies, members and API keys.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';
import type { Role } from '../src-shared/protocol';
import { foldName } from '../src-shared/text';

export type SessionMember = {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  project_ids: string[] | 'all';
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const computed = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

const SESSION_COOKIE = 'lowfield_session';

export function parseCookies(req: { headers: Record<string, string | string[] | undefined> }): Record<string, string> {
  const raw = Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie;
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Loads the member for a request's cookie. Role/assignment changes apply on the next request (DP-08). */
export async function memberForCookie(db: Db, token: string | undefined): Promise<SessionMember | null> {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT m.id, m.org_id, m.name, m.email_folded, m.role,
            COALESCE(json_agg(mp.project_id) FILTER (WHERE mp.project_id IS NOT NULL), '[]') AS project_ids
       FROM sign_in_sessions s
       JOIN members m ON m.id = s.member_id
       LEFT JOIN member_projects mp ON mp.member_id = m.id
      WHERE s.token = $1
      GROUP BY m.id, m.org_id, m.name, m.email_folded, m.role`,
    [token],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const member: SessionMember = {
    id: String(r.id),
    org_id: String(r.org_id),
    name: r.name,
    email: r.email_folded,
    role: r.role as Role,
    project_ids: r.role === 'admin' || r.role === 'billing' ? 'all' : (r.project_ids as string[]),
  };
  return member;
}

export type ApiKeyPrincipal = {
  key_id: string;
  project_id: string;
  org_id: string;
  key_role: 'developer';
};

/** Resolves Authorization: Token <key> for /v1 routes. Revoked keys are refused. */
export async function principalForToken(db: Db, secret: string): Promise<ApiKeyPrincipal | null> {
  const hash = hashApiKey(secret);
  const { rows } = await db.query(
    `SELECT k.id AS key_id, k.project_id, p.org_id
       FROM api_keys k JOIN projects p ON p.id = k.project_id
      WHERE k.secret_hash = $1 AND k.revoked_at IS NULL`,
    [hash],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { key_id: String(r.key_id), project_id: String(r.project_id), org_id: String(r.org_id), key_role: 'developer' };
}

export function newApiSecret(): { secret: string; prefix: string; hash: string } {
  const hex = randomBytes(16).toString('hex');
  const secret = `lf_live_${hex}`;
  return { secret, prefix: secret.slice(0, 12), hash: hashApiKey(secret) };
}

export function foldEmail(email: string): string {
  return foldName(email);
}
