import type { IncomingMessage } from 'node:http';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import type { Role, SessionUser } from '../domain/types.js';
import { randomToken, verifyPassword } from '../security.js';

export const SESSION_COOKIE = 'teamseat_session';

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

interface UserRow {
  id: string;
  name: string;
  role: Role;
  initials: string;
  org_code: string | null;
  org_name: string | null;
  languages: string[] | null;
}

const USER_FIELDS = `
  u.id, u.name, u.role, u.initials, u.org_code, o.name as org_name,
  array_remove(array_agg(il.language_code order by l.seed_order), null) as languages
`;

const USER_FROM = `
  from users u
  left join orgs o on o.code = u.org_code
  left join interpreter_languages il on il.user_id = u.id
  left join languages l on l.code = il.language_code
`;

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    initials: row.initials,
    orgCode: row.org_code,
    orgName: row.org_name,
    languages: row.languages ?? [],
  };
}

export async function userForSession(token: string | null): Promise<SessionUser | null> {
  if (token === null) return null;
  const row = await queryOne<UserRow>(
    `select ${USER_FIELDS} ${USER_FROM}
     join sessions s on s.user_id = u.id
     where s.token = $1 and s.expires_at > now() and u.active
     group by u.id, o.name`,
    [token],
  );
  return row === null ? null : toSessionUser(row);
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const row = await queryOne<UserRow & { password_hash: string }>(
    `select ${USER_FIELDS}, u.password_hash ${USER_FROM}
     where lower(u.email) = lower($1) and u.active
     group by u.id, o.name`,
    [email],
  );
  if (row === null) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return toSessionUser(row);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  await query(
    `insert into sessions (token, user_id, expires_at)
     values ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [token, userId, String(config.sessionTtlSeconds)],
  );
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

export async function deleteSessionsOfUser(userId: string): Promise<void> {
  await query('delete from sessions where user_id = $1', [userId]);
}
