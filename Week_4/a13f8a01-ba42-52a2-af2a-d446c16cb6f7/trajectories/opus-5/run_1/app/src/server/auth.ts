import type { User } from '../shared/api';
import { one, query } from './db';
import { apiError } from './errors';
import { newId, newToken } from './util';

export const SESSION_COOKIE = 'ashlar_session';

export interface UserRow {
  id: string;
  handle: string;
  email: string;
  email_lower: string;
  password_hash: string | null;
  verified: boolean;
}

export const userShape = (user: UserRow): User => ({
  id: user.id,
  handle: user.handle,
  email: user.email,
  verified: user.verified,
});

export const createSession = async (userId: string): Promise<string> => {
  const id = newToken();
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
};

export const destroySession = async (id: string): Promise<void> => {
  await query('delete from sessions where id = $1', [id]);
};

export const userForSession = async (sessionId: string | null): Promise<UserRow | null> => {
  if (!sessionId) return null;
  return one<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
};

export const findUserByHandle = async (handle: string): Promise<UserRow | null> =>
  one<UserRow>('select * from users where handle = $1', [handle]);

export const findUserByEmail = async (email: string): Promise<UserRow | null> =>
  one<UserRow>('select * from users where email_lower = $1', [email.toLowerCase()]);

export const insertUser = async (input: {
  handle: string;
  email: string;
  passwordHash: string | null;
  verified: boolean;
}): Promise<UserRow> => {
  const rows = await query<UserRow>(
    `insert into users (id, handle, email, email_lower, password_hash, verified)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [newId(), input.handle, input.email, input.email.toLowerCase(), input.passwordHash, input.verified],
  );
  return rows[0]!;
};

export const requireUser = (user: UserRow | null): UserRow => {
  if (!user) throw apiError('not_signed_in');
  return user;
};

/** Actions an unverified account may not take answer 403 unverified and change nothing. */
export const requireVerified = (user: UserRow): UserRow => {
  if (!user.verified) throw apiError('unverified');
  return user;
};

export const serializeSessionCookie = (sessionId: string): string =>
  `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;

export const clearSessionCookie = (): string =>
  `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
};
