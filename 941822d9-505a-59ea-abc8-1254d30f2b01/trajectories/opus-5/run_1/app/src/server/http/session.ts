import { one, pool } from '../db/pool.js';
import { randomToken } from '../util/ids.js';
import type { AuthUser } from './context.js';
import type { Role } from '../domain/courseLifecycle.js';

export const SESSION_COOKIE = 'credwell_session';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  organisation_id: string | null;
  organisation_name: string | null;
  organisation_slug: string | null;
  organisation_kind: string | null;
  licence_number: string | null;
  date_of_birth: string | null;
}

const USER_SELECT = `
  SELECT u.id, u.email, u.display_name, u.role, u.organisation_id,
         o.name AS organisation_name, o.slug AS organisation_slug, o.kind AS organisation_kind,
         u.licence_number, u.date_of_birth
  FROM users u LEFT JOIN organisations o ON o.id = u.organisation_id
`;

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as Role,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    organisationSlug: row.organisation_slug,
    organisationKind: row.organisation_kind === null ? null : (row.organisation_kind as 'provider' | 'hospital'),
    licenceNumber: row.licence_number,
    dateOfBirth: row.date_of_birth,
  };
}

export async function userForSession(token: string): Promise<AuthUser | null> {
  const row = await one<UserRow>(
    pool,
    `${USER_SELECT} JOIN sessions s ON s.user_id = u.id WHERE s.token = $1`,
    [token],
  );
  return row === null ? null : toAuthUser(row);
}

export async function userById(id: string): Promise<AuthUser | null> {
  const row = await one<UserRow>(pool, `${USER_SELECT} WHERE u.id = $1`, [id]);
  return row === null ? null : toAuthUser(row);
}

export async function userByEmail(email: string): Promise<{ user: AuthUser; passwordHash: string } | null> {
  const row = await one<UserRow & { password_hash: string }>(
    pool,
    `SELECT u.id, u.email, u.display_name, u.role, u.organisation_id,
            o.name AS organisation_name, o.slug AS organisation_slug, o.kind AS organisation_kind,
            u.licence_number, u.date_of_birth, u.password_hash
     FROM users u LEFT JOIN organisations o ON o.id = u.organisation_id
     WHERE lower(u.email) = lower($1)`,
    [email],
  );
  return row === null ? null : { user: toAuthUser(row), passwordHash: row.password_hash };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (header === undefined) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    jar[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
