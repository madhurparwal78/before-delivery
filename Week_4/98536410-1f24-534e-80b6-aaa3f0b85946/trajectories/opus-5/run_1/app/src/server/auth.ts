import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';
import { invalidCredentials, tooManyAttempts } from './http/errors.js';
import type { Role, SessionUser } from './http/context.js';
import { hashPassword, verifyPassword } from './seed.js';

export const SESSION_COOKIE = 'tramela_session';
const MAX_FAILURES = 5;

/** A hash to verify against for unknown emails, so their answers take the same order of time. */
const DECOY_HASH = hashPassword(randomUUID());

const LANDING_OF_ROLE: Readonly<Record<Role, string>> = {
  lead: '/estate',
  care: '/care',
  shopper: '/catalogue',
  manager: '/shop',
};

function foldEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export async function resolveSession(sessionId: string | null): Promise<SessionUser | null> {
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const rows = await query(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.operator_id, u.email, u.name, u.role,
            COALESCE(array_agg(us.store_id ORDER BY us.store_id) FILTER (WHERE us.store_id IS NOT NULL), '{}') AS store_ids
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN user_stores us ON us.user_id = u.id
      WHERE s.id = $1 AND s.ended_at IS NULL AND s.expires_at > now()
      GROUP BY s.id, s.expires_at, u.id`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row['session_id'] as string,
    userId: row['user_id'] as string,
    operatorId: row['operator_id'] as string,
    email: row['email'] as string,
    name: row['name'] as string,
    role: row['role'] as Role,
    storeIds: row['store_ids'] as string[],
    expiresAt: row['expires_at'] as Date,
  };
}

async function landingRouteFor(session: {
  role: Role;
  storeIds: string[];
}): Promise<string> {
  if (session.role !== 'manager') return LANDING_OF_ROLE[session.role];
  const lowest = [...session.storeIds].sort()[0];
  return lowest ? `/shop/${lowest}` : '/';
}

export type SignInResult = {
  sessionId: string;
  user: SessionUser;
  landing: string;
};

/**
 * The single place the sign-in lock lives: five failures for one email inside the window
 * lock it, counted in PostgreSQL so every app copy shares the count.
 */
export async function signIn(email: unknown, password: unknown): Promise<SignInResult> {
  const folded = foldEmail(email);

  const recent = await query(
    `SELECT at FROM sign_in_attempts
      WHERE email = $1 AND at > now() - ($2 || ' seconds')::interval
      ORDER BY at DESC LIMIT $3`,
    [folded, String(config.signInWindowSeconds), MAX_FAILURES],
  );
  if (recent.length >= MAX_FAILURES) {
    const oldest = recent[recent.length - 1]!['at'] as Date;
    const freeAt = oldest.getTime() + config.signInWindowSeconds * 1000;
    const retryAfter = Math.max(1, Math.ceil((freeAt - Date.now()) / 1000));
    throw tooManyAttempts(retryAfter);
  }

  const rows = await query(
    `SELECT u.id, u.operator_id, u.email, u.name, u.role, u.password_hash,
            COALESCE(array_agg(us.store_id ORDER BY us.store_id) FILTER (WHERE us.store_id IS NOT NULL), '{}') AS store_ids
       FROM users u LEFT JOIN user_stores us ON us.user_id = u.id
      WHERE lower(u.email) = $1 GROUP BY u.id`,
    [folded],
  );
  const row = rows[0];
  const supplied = typeof password === 'string' ? password : '';
  const matches = verifyPassword(supplied, (row?.['password_hash'] as string) ?? DECOY_HASH);

  if (!row || !matches) {
    await query(`INSERT INTO sign_in_attempts (email, at) VALUES ($1, now())`, [folded]);
    throw invalidCredentials();
  }

  await query(`DELETE FROM sign_in_attempts WHERE email = $1`, [folded]);

  const sessionId = randomUUID();
  const inserted = await query(
    `INSERT INTO sessions (id, user_id, created_at, expires_at)
     VALUES ($1,$2, now(), now() + ($3 || ' seconds')::interval) RETURNING expires_at`,
    [sessionId, row['id'], String(config.sessionSeconds)],
  );

  const user: SessionUser = {
    sessionId,
    userId: row['id'] as string,
    operatorId: row['operator_id'] as string,
    email: row['email'] as string,
    name: row['name'] as string,
    role: row['role'] as Role,
    storeIds: row['store_ids'] as string[],
    expiresAt: inserted[0]!['expires_at'] as Date,
  };

  return { sessionId, user, landing: await landingRouteFor(user) };
}

export async function endSession(sessionId: string): Promise<void> {
  await query(`UPDATE sessions SET ended_at = now() WHERE id = $1`, [sessionId]);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    result[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return result;
}

export async function operatorOf(operatorId: string): Promise<{ id: string; name: string }> {
  const row = (await query(`SELECT id, name FROM operators WHERE id = $1`, [operatorId]))[0]!;
  return { id: row['id'] as string, name: row['name'] as string };
}

export function sessionCookieHeader(sessionId: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
