import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db.js';
import { one } from './db.js';
import { now, secondsFromNow } from './clock.js';
import type { OwnAccount, PublicUser } from '../shared/types.js';

export const SESSION_COOKIE = 'mh_session';
const SESSION_SECONDS = 30 * 24 * 3600;

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  totpEnabled: boolean;
  createdAt: Date;
}

export interface Session { user: SessionUser | null; suspended: boolean }

interface UserRow {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  role: 'user' | 'admin';
  totp_enabled: boolean;
  created_at: Date;
}

export const USER_COLUMNS = 'u.id, u.username, u.email, u.email_verified, u.role, u.totp_enabled, u.created_at';

export function sessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    emailVerified: row.email_verified,
    role: row.role,
    totpEnabled: row.totp_enabled,
    createdAt: row.created_at,
  };
}

export const ownAccount = (user: SessionUser): OwnAccount => ({
  id: user.id,
  username: user.username,
  email: user.email,
  emailVerified: user.emailVerified,
  totpEnabled: user.totpEnabled,
  role: user.role,
  createdAt: user.createdAt.toISOString(),
});

export const publicUser = (user: { username: string; created_at: Date }): PublicUser => ({
  username: user.username,
  createdAt: user.created_at.toISOString(),
});

export const hashPassword = (password: string): Promise<string> => hash(password);
export const passwordMatches = (stored: string, password: string): Promise<boolean> =>
  verify(stored, password).catch(() => false);

export const tokenDigest = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  totpSecret: string | null;
  createdAt: Date;
}

/** Inserts an account. Throws a unique violation when the username or email is taken. */
export async function insertUser(db: Db, user: NewUser): Promise<string> {
  const inserted = await one<{ id: string }>(db,
    `INSERT INTO users (username, username_key, email, email_key, password_hash, email_verified, role, totp_secret, totp_enabled, created_at)
     VALUES ($1, lower($1), $2, lower($2), $3, $4, $5, $6, $7, $8) RETURNING id`,
    [user.username, user.email, user.passwordHash, user.emailVerified, user.role, user.totpSecret,
      user.totpSecret !== null, user.createdAt]);
  return (inserted as { id: string }).id;
}

export async function findUserByLogin(db: Db, login: string): Promise<(UserRow & {
  password_hash: string; totp_secret: string | null; suspended_at: Date | null; locked_until: Date | null;
}) | null> {
  return one(db,
    `SELECT ${USER_COLUMNS}, u.password_hash, u.totp_secret, u.suspended_at, u.locked_until
     FROM users u WHERE u.email_key = lower($1) OR u.username_key = lower($1) ORDER BY (u.email_key = lower($1)) DESC LIMIT 1`,
    [login.trim()]);
}

export async function findUserByUsername(db: Db, username: string): Promise<(UserRow & { suspended_at: Date | null }) | null> {
  return one(db, `SELECT ${USER_COLUMNS}, u.suspended_at FROM users u WHERE u.username_key = lower($1)`, [username]);
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = newToken();
  await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [tokenDigest(token), userId, now(), secondsFromNow(SESSION_SECONDS)]);
  return token;
}

export async function revokeSessions(db: Db, userId: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, now()]);
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenDigest(token), now()]);
}

/** Resolves a session cookie. A suspended account is reported as such even though its sessions are revoked. */
export async function resolveSession(db: Db, token: string | undefined): Promise<Session> {
  if (!token) return { user: null, suspended: false };
  const row = await one<UserRow & { suspended_at: Date | null; revoked_at: Date | null; expires_at: Date }>(db,
    `SELECT ${USER_COLUMNS}, u.suspended_at, s.revoked_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [tokenDigest(token)]);
  if (!row) return { user: null, suspended: false };
  if (row.suspended_at) return { user: null, suspended: true };
  if (row.revoked_at || row.expires_at <= now()) return { user: null, suspended: false };
  return { user: sessionUser(row), suspended: false };
}
