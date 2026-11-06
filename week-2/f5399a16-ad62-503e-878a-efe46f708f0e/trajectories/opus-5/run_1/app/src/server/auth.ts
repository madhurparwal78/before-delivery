import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { foldForCompare } from '../domain/folding.js';
import { config } from './config.js';
import { one, query } from './infra/db.js';
import type { Context } from './http.js';

const derive = promisify(scrypt);

export const SESSION_COOKIE = 'clapstick_session';

export type Desk = { id: string; name: string; email: string };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 32)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = '', hex = ''] = stored.split(':');
  const key = (await derive(password, salt, 32)) as Buffer;
  const held = Buffer.from(hex, 'hex');
  return held.length === key.length && timingSafeEqual(held, key);
}

/** A session ends SESSION_SECONDS after sign-in, and the server alone decides that. */
export async function startSession(deskId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await query(
    'insert into sessions (token, desk_id, created_at, expires_at) values ($1,$2,$3,$4)',
    [token, deskId, now, new Date(now.getTime() + config.timers.sessionSeconds * 1000)],
  );
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('update sessions set ended_at = now() where token = $1 and ended_at is null', [
    token,
  ]);
}

export async function endOtherSessions(deskId: string, keep: string): Promise<void> {
  await query(
    'update sessions set ended_at = now() where desk_id = $1 and token <> $2 and ended_at is null',
    [deskId, keep],
  );
}

/** The session cookie is HttpOnly, SameSite=Lax, never Secure, with no Max-Age or Expires. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax`;
}

export type SessionState =
  | { kind: 'none' }
  | { kind: 'ended' }
  | { kind: 'live'; token: string; desk: Desk };

export async function readSession(context: Context): Promise<SessionState> {
  const token = context.cookies[SESSION_COOKIE];
  if (token === undefined || token === '') return { kind: 'none' };
  const row = await one<{
    desk_id: string;
    name: string;
    email: string;
    expires_at: Date;
    ended_at: Date | null;
  }>(
    `select s.desk_id, d.name, d.email, s.expires_at, s.ended_at
       from sessions s join desks d on d.id = s.desk_id
      where s.token = $1`,
    [token],
  );
  if (!row || row.ended_at !== null || row.expires_at.getTime() <= Date.now()) {
    return { kind: 'ended' };
  }
  return {
    kind: 'live',
    token,
    desk: { id: row.desk_id, name: row.name, email: row.email },
  };
}

export async function findDeskByEmail(email: string): Promise<
  | {
      id: string;
      name: string;
      email: string;
      password_hash: string;
    }
  | null
> {
  return one(
    'select id, name, email, password_hash from desks where email_folded = $1',
    [foldForCompare(email)],
  );
}

export async function createDesk(
  name: string,
  email: string,
  password: string,
): Promise<Desk> {
  const id = randomUUID();
  await query(
    `insert into desks (id, name, email, email_folded, password_hash, created_at)
     values ($1,$2,$3,$4,$5,now())`,
    [id, name, email, foldForCompare(email), await hashPassword(password)],
  );
  return { id, name, email };
}
