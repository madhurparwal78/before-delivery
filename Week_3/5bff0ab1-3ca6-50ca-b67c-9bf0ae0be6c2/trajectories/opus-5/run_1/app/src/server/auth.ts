import { randomBytes } from 'node:crypto';
import { SESSION_HOURS } from '../shared/catalogue.js';
import type { User } from '../shared/types.js';
import { appNow } from './clock.js';
import { one, query, type Row } from './db.js';
import { userView } from './domain/views.js';

export const SESSION_COOKIE = 'malhar_session';

export interface Caller {
  token: string;
  user: User;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query('insert into sessions (token, user_id, created_at) values ($1,$2,$3)', [
    token,
    userId,
    appNow(),
  ]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query(`update sessions set ended_by = 'signed_out' where token = $1`, [token]);
}

export interface SessionLookup {
  state: 'none' | 'ended' | 'live';
  caller: Caller | null;
}

/** A session ends 12 hours after sign-in on the app clock. */
export async function lookupSession(token: string | undefined): Promise<SessionLookup> {
  if (!token) return { state: 'none', caller: null };
  const row = await one<Row>(
    `select s.token, s.created_at, s.ended_by, u.* from sessions s join users u on u.id = s.user_id
      where s.token = $1`,
    [token],
  );
  if (!row) return { state: 'ended', caller: null };
  if (row.ended_by) return { state: 'ended', caller: null };
  const createdAt = row.created_at as Date;
  if (appNow().getTime() - createdAt.getTime() >= SESSION_HOURS * 3_600_000) {
    return { state: 'ended', caller: null };
  }
  return { state: 'live', caller: { token, user: userView(row) } };
}
