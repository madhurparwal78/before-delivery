import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { id, q1, q } from './db.js';
import { type Ctx, forbidden, notFound, type SessionUser } from './http.js';
import type { Role } from '../shared/types.js';

const ROLE_RANK: Record<Role, number> = { viewer: 1, explorer: 2, creator: 3 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hex] = stored.split(':');
  if (salt === undefined || hex === undefined) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export async function createUser(username: string, password: string): Promise<SessionUser> {
  const userId = id();
  await q1('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)', [
    userId,
    username,
    hashPassword(password),
  ]);
  return { id: userId, username };
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = id();
  await q1('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [sessionId, userId]);
  return sessionId;
}

export function cookieFor(sessionId: string): string {
  return `loz_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return 'loz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export async function userForSession(sessionId: string): Promise<SessionUser | null> {
  const row = await q1<{ id: string; username: string }>(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
    [sessionId],
  );
  return row === null ? null : { id: row.id, username: row.username };
}

export async function userByName(username: string): Promise<{ id: string; username: string; password_hash: string } | null> {
  return q1<{ id: string; username: string; password_hash: string }>(
    'SELECT id, username, password_hash FROM users WHERE username = $1',
    [username],
  );
}

export async function roleIn(projectId: string, userId: string): Promise<Role | null> {
  const row = await q1<{ role: Role }>('SELECT role FROM members WHERE project_id = $1 AND user_id = $2', [
    projectId,
    userId,
  ]);
  return row === null ? null : row.role;
}

export async function projectAccess(ctx: Ctx, projectId: string, min: Role): Promise<Role> {
  const user = ctx.user;
  if (user === null) notFound();
  const role = await roleIn(projectId, user.id);
  if (role === null) notFound();
  if (ROLE_RANK[role] < ROLE_RANK[min]) forbidden();
  return role;
}

export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function projectsFor(userId: string): Promise<{ id: string; name: string; role: Role }[]> {
  return q<{ id: string; name: string; role: Role }>(
    'SELECT p.id, p.name, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.created_at',
    [userId],
  );
}
