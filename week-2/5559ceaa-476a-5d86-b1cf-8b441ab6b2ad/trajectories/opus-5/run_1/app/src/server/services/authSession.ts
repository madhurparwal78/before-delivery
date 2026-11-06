import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { User } from '../../shared/api.js';
import { pool, type Queryable } from '../db.js';
import { readHeader } from '../http/context.js';

const COOKIE_NAME = 'rb_session';

function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    jar.set(part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim()));
  }
  return jar;
}

export async function startAuthSession(client: Queryable, userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await client.query('insert into auth_sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export const sessionCookie = (id: string) =>
  `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax`;

export const clearedSessionCookie = () =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function endAuthSession(req: IncomingMessage): Promise<void> {
  const id = parseCookies(readHeader(req, 'cookie')).get(COOKIE_NAME);
  if (id === undefined) return;
  await pool.query('delete from auth_sessions where id = $1', [id]);
}

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  kind: 'mentor' | 'learner';
}

export async function currentUser(req: IncomingMessage): Promise<User | null> {
  const id = parseCookies(readHeader(req, 'cookie')).get(COOKIE_NAME);
  if (id === undefined) return null;
  const { rows } = await pool.query<UserRow>(
    `select u.id, u.email, u.name, u.kind
       from auth_sessions s join users u on u.id = s.user_id
      where s.id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, email: row.email, name: row.name, kind: row.kind };
}
