import { randomBytes } from 'node:crypto';
import { config } from './config';
import type { Queryable } from './db/queryable';
import type { OrgRole } from './db/seed-data';
import { verifyPassword } from './db/seed';
import type { Person } from './projects';

export const SESSION_COOKIE = 'fluxseal_session';

interface PersonRow {
  id: string;
  name: string;
  email: string;
  org_role: OrgRole;
}

export async function personByEmail(
  executor: Queryable,
  email: string,
  password: string,
): Promise<Person | null> {
  const result = await executor.query<PersonRow & { password_hash: string }>(
    'select id, name, email, org_role, password_hash from people where lower(email) = lower($1)',
    [email],
  );
  const row = result.rows[0];
  if (row === undefined || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, name: row.name, email: row.email, orgRole: row.org_role };
}

export async function createSession(executor: Queryable, personId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await executor.query(
    `insert into sessions (id, person_id, created_at, expires_at)
     values ($1, $2, now(), now() + make_interval(secs => $3))`,
    [id, personId, config.sessionTtlSeconds],
  );
  return id;
}

export async function sessionPerson(
  executor: Queryable,
  sessionId: string | undefined,
): Promise<Person | null> {
  if (sessionId === undefined || sessionId === '') return null;
  const result = await executor.query<PersonRow>(
    `select people.id, people.name, people.email, people.org_role
     from sessions join people on people.id = sessions.person_id
     where sessions.id = $1 and sessions.expires_at > now()`,
    [sessionId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : { id: row.id, name: row.name, email: row.email, orgRole: row.org_role };
}

export async function destroySession(executor: Queryable, sessionId: string | undefined): Promise<void> {
  if (sessionId === undefined || sessionId === '') return;
  await executor.query('delete from sessions where id = $1', [sessionId]);
}

export function sessionCookie(sessionId: string): string {
  return [
    `${SESSION_COOKIE}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.sessionTtlSeconds}`,
  ].join('; ');
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
