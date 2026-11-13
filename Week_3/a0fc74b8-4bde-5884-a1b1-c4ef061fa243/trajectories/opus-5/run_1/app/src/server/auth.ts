import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { query, queryOne } from './db/pool.ts';
import { unauthenticated } from './http/errors.ts';
import type { Ctx } from './http/server.ts';
import type { Role } from '../shared/types.ts';

export const SESSION_COOKIE = 'undersign_session';

export interface Caller {
  userId: string;
  email: string;
  name: string;
  teamId: string;
  teamName: string;
  role: Role;
}

const isRole = (value: string): value is Role =>
  value === 'owner' || value === 'member' || value === 'viewer';

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.byteLength);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
};

type CallerRow = {
  user_id: string;
  email: string;
  name: string;
  team_id: string;
  team_name: string;
  role: string;
};

export const callerOf = async (ctx: Ctx): Promise<Caller | null> => {
  const sessionId = ctx.cookies[SESSION_COOKIE];
  if (!sessionId || !/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  const row = await queryOne<CallerRow>(
    `SELECT u.id AS user_id, u.email, u.name, u.role, t.id AS team_id, t.name AS team_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN teams t ON t.id = u.team_id
     WHERE s.id = $1`,
    [sessionId],
  );
  if (!row || !isRole(row.role)) return null;
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    teamId: row.team_id,
    teamName: row.team_name,
    role: row.role,
  };
};

export const requireCaller = async (ctx: Ctx): Promise<Caller> => {
  const caller = await callerOf(ctx);
  if (!caller) throw unauthenticated();
  return caller;
};

export const createSession = async (userId: string): Promise<string> => {
  const id = randomUUID();
  await query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  return id;
};

export const destroySession = async (sessionId: string): Promise<void> => {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
};

export const setSessionCookie = (res: ServerResponse, sessionId: string): void => {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
};

export const clearSessionCookie = (res: ServerResponse): void => {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
};
