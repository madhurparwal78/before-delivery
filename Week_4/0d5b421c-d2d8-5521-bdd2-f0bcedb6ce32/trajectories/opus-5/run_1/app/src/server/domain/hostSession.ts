import type { Request, Response } from 'express';
import { serverNow } from '../clock';
import { pool, query, verifyPassword } from '../db';
import { errors } from '../errors';
import { hostSessionEnd, newToken } from './rules';

export const SESSION_COOKIE = 'ss_host';

export interface HostAccount {
  email: string;
  name: string;
}

export interface HostSession extends HostAccount {
  token: string;
  expiresAt: Date;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function signIn(email: string, password: string): Promise<HostSession> {
  const account = await query<{
    email: string;
    name: string;
    password_hash: string;
  }>(pool, 'select email, name, password_hash from host_accounts where lower(email) = lower($1)', [
    email,
  ]);
  const row = account.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) throw errors.invalidCredentials();
  const token = newToken();
  const signedInAt = serverNow();
  const expiresAt = hostSessionEnd(signedInAt);
  await query(
    pool,
    'insert into host_sessions(token, email, created_at, expires_at) values ($1, $2, $3, $4)',
    [token, row.email, signedInAt, expiresAt],
  );
  return { token, email: row.email, name: row.name, expiresAt };
}

/** A host session is live while the server's now is before its end, 12 hours after sign-in. */
export async function currentHost(req: Request): Promise<HostAccount> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) throw errors.unauthenticated();
  const result = await query<{ email: string; name: string; expires_at: Date }>(
    pool,
    `select s.email, a.name, s.expires_at from host_sessions s
     join host_accounts a on a.email = s.email where s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) throw errors.unauthenticated();
  if (new Date(row.expires_at).getTime() <= serverNow().getTime()) throw errors.unauthenticated();
  return { email: row.email, name: row.name };
}

export async function signOut(req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await query(pool, 'delete from host_sessions where token = $1', [token]);
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}
