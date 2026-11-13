import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { SCHEMA_SQL } from './schema.js';
import { pool } from './db.js';

export const SESSION_COOKIE = 'plot_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return candidate.length === hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export async function applySchema(): Promise<void> {
  for (const sql of SCHEMA_SQL) {
    await pool.query(sql);
  }
}

export async function sessionUser(request: IncomingMessage): Promise<string | null> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie) return null;
  const result = await pool.query<{ username: string }>('SELECT username FROM sessions WHERE token = $1', [cookie]);
  return result.rows[0]?.username ?? null;
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export async function createSession(username: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query('INSERT INTO sessions (token, username) VALUES ($1, $2)', [token, username]);
  return token;
}

export async function dropSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export const ROLES = ['view', 'markup', 'edit', 'manage'] as const;
export type Role = (typeof ROLES)[number];

export function roleAtLeast(role: Role, needed: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(needed);
}

export async function roleForFolder(folderId: string, username: string | null): Promise<Role | null> {
  if (!username) return null;
  const parents = await folderChain(folderId);
  const ordered = parents.slice().reverse();
  for (const folder of ordered) {
    const direct = await pool.query<{ role: Role }>('SELECT role FROM folder_roles WHERE folder_id = $1 AND username = $2', [folder, username]);
    if (direct.rows[0]) return direct.rows[0].role;
  }
  return null;
}

export async function roleForDrawing(drawingId: string, username: string | null): Promise<Role | null> {
  if (!username) return null;
  const result = await pool.query<{ folder_id: string }>('SELECT folder_id FROM drawings WHERE id = $1', [drawingId]);
  const folderId = result.rows[0]?.folder_id;
  if (!folderId) return null;
  return roleForFolder(folderId, username);
}

// Effective roles: a folder's own role wins; otherwise inherited from nearest ancestor with one.
export async function folderChain(folderId: string): Promise<string[]> {
  const chain: string[] = [];
  let current: string | null = folderId;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    chain.push(current);
    const row: { parent_id: string | null } | undefined = (await pool.query<{ parent_id: string | null }>('SELECT parent_id FROM folders WHERE id = $1', [current])).rows[0];
    current = row?.parent_id ?? null;
  }
  return chain;
}

export async function foldersForUser(username: string | null): Promise<Array<{ id: string; name: string; parent_id: string | null; role: Role }>> {
  if (!username) return [];
  const result = await pool.query<{ id: string; name: string; parent_id: string | null }>('SELECT id, name, parent_id FROM folders');
  const folders: Array<{ id: string; name: string; parent_id: string | null; role: Role }> = [];
  for (const row of result.rows) {
    const role = await roleForFolder(row.id, username);
    if (role) folders.push({ id: row.id, name: row.name, parent_id: row.parent_id, role });
  }
  return folders;
}

export async function loginAttempts(username: string, limit: number, windowMs: number, now: Date): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM login_attempts WHERE username = $1 AND at > $2 AND ok = false',
    [username, new Date(now.getTime() - windowMs)],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function recordLoginAttempt(username: string, ok: boolean, now: Date): Promise<void> {
  await pool.query('INSERT INTO login_attempts (username, ok, at) VALUES ($1, $2, $3)', [username, ok, now]);
}
