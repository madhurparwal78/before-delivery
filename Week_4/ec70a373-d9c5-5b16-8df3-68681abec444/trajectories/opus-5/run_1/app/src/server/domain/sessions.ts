import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { nowMs } from '../clock';
import { query, queryOne } from '../db';
import type { Role } from '../../shared/types';

export interface SignedInUser {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string;
  site_id: string | null;
}

export interface LiveSession {
  session_id: string;
  session_value: string;
  csrf_value: string;
  user: SignedInUser;
}

export type SessionLookup =
  | { state: 'live'; session: LiveSession }
  | { state: 'expired'; userId: string }
  | { state: 'invalid' };

interface SessionRow {
  id: string;
  session_value: string;
  csrf_value: string;
  created_at: string;
  last_used_at: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string;
  site_id: string | null;
}

function secret(): string {
  return randomBytes(32).toString('base64url');
}

/** Compared against when no user has that email, so both answers cost the same work. */
const DUMMY_HASH = bcrypt.hashSync('pilotlight-no-such-user', 10);

export async function lookupSession(value: string): Promise<SessionLookup> {
  const row = await queryOne<SessionRow>(
    `select s.id, s.session_value, s.csrf_value,
            s.created_at, s.last_used_at,
            u.id as user_id, u.name, u.email, u.role, u.tenant_id, u.site_id
       from sessions s join users u on u.id = s.user_id
      where s.session_value = $1`,
    [value],
  );
  if (row === null) return { state: 'invalid' };
  const now = nowMs();
  const idleDeadline = Date.parse(row.last_used_at) + config.sessionIdleSeconds * 1000;
  const absoluteDeadline = Date.parse(row.created_at) + config.sessionAbsoluteSeconds * 1000;
  if (now > idleDeadline || now > absoluteDeadline) {
    return { state: 'expired', userId: row.user_id };
  }
  await query('update sessions set last_used_at = $2 where id = $1', [
    row.id,
    new Date(now).toISOString(),
  ]);
  return {
    state: 'live',
    session: {
      session_id: row.id,
      session_value: row.session_value,
      csrf_value: row.csrf_value,
      user: {
        user_id: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
        tenant_id: row.tenant_id,
        site_id: row.site_id,
      },
    },
  };
}

export async function destroySessionValue(value: string): Promise<void> {
  await query('delete from sessions where session_value = $1', [value]);
}

export interface ThrottleVerdict {
  throttled: boolean;
  retryAfterSeconds: number;
}

async function oldestFailure(
  column: 'email_lower' | 'address',
  value: string,
  limit: number,
): Promise<number | null> {
  const since = new Date(nowMs() - config.signInThrottleWindowSeconds * 1000).toISOString();
  const rows = await query<{ at: string }>(
    `select at from sign_in_failures where ${column} = $1 and at > $2 order by at asc`,
    [value, since],
  );
  if (rows.length < limit) return null;
  return Date.parse((rows[0] as { at: string }).at);
}

export async function signInThrottle(
  emailLower: string,
  address: string | null,
): Promise<ThrottleVerdict> {
  const byEmail = await oldestFailure('email_lower', emailLower, 5);
  const byAddress = address === null ? null : await oldestFailure('address', address, 20);
  const ends: number[] = [];
  const window = config.signInThrottleWindowSeconds * 1000;
  if (byEmail !== null) ends.push(byEmail + window);
  if (byAddress !== null) ends.push(byAddress + window);
  if (ends.length === 0) return { throttled: false, retryAfterSeconds: 0 };
  const until = Math.max(...ends);
  return {
    throttled: true,
    retryAfterSeconds: Math.max(1, Math.ceil((until - nowMs()) / 1000)),
  };
}

export async function recordSignInFailure(
  emailLower: string,
  address: string | null,
): Promise<void> {
  await query('insert into sign_in_failures (email_lower, address, at) values ($1,$2,$3)', [
    emailLower,
    address,
    new Date(nowMs()).toISOString(),
  ]);
}

export interface Credentials {
  emailLower: string;
  password: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string;
  site_id: string | null;
  password_hash: string;
}

export async function verifyCredentials(
  credentials: Credentials,
): Promise<SignedInUser | null> {
  const row = await queryOne<UserRow>(
    `select id, name, email, role, tenant_id, site_id, password_hash
       from users where email_lower = $1`,
    [credentials.emailLower],
  );
  if (row === null) {
    /* the same work either way, so an unknown email is indistinguishable */
    await bcrypt.compare(credentials.password, DUMMY_HASH);
    return null;
  }
  const matches = await bcrypt.compare(credentials.password, row.password_hash);
  if (!matches) return null;
  return {
    user_id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    tenant_id: row.tenant_id,
    site_id: row.site_id,
  };
}

export interface IssuedSession {
  sessionValue: string;
  csrfValue: string;
}

/** A fresh session replaces whatever value the request carried, and caps the user at three. */
export async function issueSession(
  userId: string,
  presentedValue: string | null,
): Promise<IssuedSession> {
  if (presentedValue !== null) await destroySessionValue(presentedValue);
  const sessionValue = secret();
  const csrfValue = secret();
  const now = new Date(nowMs()).toISOString();
  await query(
    `insert into sessions (id, user_id, session_value, csrf_value, created_at, last_used_at)
     values ($1,$2,$3,$4,$5,$5)`,
    [randomUUID(), userId, sessionValue, csrfValue, now],
  );
  await query('delete from sign_in_failures where email_lower = (select email_lower from users where id = $1)', [
    userId,
  ]);
  const live = await query<{ id: string }>(
    `select id from sessions
      where user_id = $1
        and last_used_at > $2
        and created_at > $3
      order by created_at asc`,
    [
      userId,
      new Date(nowMs() - config.sessionIdleSeconds * 1000).toISOString(),
      new Date(nowMs() - config.sessionAbsoluteSeconds * 1000).toISOString(),
    ],
  );
  const excess = live.length - 3;
  for (let index = 0; index < excess; index += 1) {
    const victim = live[index] as { id: string };
    await query('delete from sessions where id = $1', [victim.id]);
  }
  return { sessionValue, csrfValue };
}
