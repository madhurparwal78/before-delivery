import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { query } from './db.js';
import { parseCookies } from './http.js';
import type { Role, SessionUser } from '../shared/types.js';

export const SESSION_COOKIE = 'slackwater_session';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${salt.toString('base64')}:${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltPart, hashPart] = stored.split(':');
  if (!saltPart || !hashPart) return false;
  const expected = Buffer.from(hashPart, 'base64');
  const derived = scryptSync(password, Buffer.from(saltPart, 'base64'), expected.length);
  return timingSafeEqual(expected, derived);
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  capacity: number;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const id = newId('s');
  await query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  return id;
}

export async function deleteSession(id: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [id]);
}

export async function userForRequest(req: IncomingMessage): Promise<SessionUser | null> {
  const sessionId = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  if (!sessionId) return null;
  const rows = await query<{ id: string; name: string; email: string }>(
    `SELECT users.id, users.name, users.email
       FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function workspacesOf(userId: string): Promise<{ id: string; name: string; role: Role }[]> {
  return query<{ id: string; name: string; role: Role }>(
    `SELECT workspaces.id, workspaces.name, members.role
       FROM members JOIN workspaces ON workspaces.id = members.workspace_id
      WHERE members.user_id = $1
      ORDER BY members.joined_at DESC, workspaces.name`,
    [userId],
  );
}

export async function roleInWorkspace(userId: string, workspaceId: string): Promise<Role | null> {
  const rows = await query<{ role: Role }>(
    'SELECT role FROM members WHERE user_id = $1 AND workspace_id = $2',
    [userId, workspaceId],
  );
  return rows[0]?.role ?? null;
}
