// Sessions: HttpOnly SameSite=Lax cookies, stored in Postgres, ending after the idle time.
import { randomBytes } from 'node:crypto';
import type { Db } from './db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { User } from '../shared/api';

export interface SessionRow {
  token: string;
  user_id: number;
  last_activity: Date;
}

export interface AuthContext {
  user: User | null;
  sessionEnded: boolean;
  token: string | null;
}

export const SESSION_COOKIE = 'pegworth_session';

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  const attrs = `HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`;
  appendHeader(res, 'Set-Cookie', `${SESSION_COOKIE}=${token}; ${attrs}`);
}

export function clearSessionCookie(res: ServerResponse): void {
  appendHeader(res, 'Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function appendHeader(res: ServerResponse, name: string, value: string): void {
  const existing = res.getHeader(name);
  if (existing === undefined) {
    res.setHeader(name, value);
  } else if (Array.isArray(existing)) {
    res.setHeader(name, [...existing, value]);
  } else {
    res.setHeader(name, [String(existing), value]);
  }
}

/** Judge idleness from the last activity recorded in Postgres by any instance. */
export async function authenticate(db: Db, req: IncomingMessage, idleSeconds: number, isWrite: boolean): Promise<AuthContext> {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE] ?? null;
  if (token === null) return { user: null, sessionEnded: false, token: null };
  const row = await db.one<SessionRow & { name: string; email: string; role: string }>(
    `SELECT s.token, s.user_id, s.last_activity, u.name, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  if (row === null) return { user: null, sessionEnded: false, token: null };
  const idleMs = Date.now() - row.last_activity.getTime();
  if (idleMs > idleSeconds * 1000) {
    return { user: null, sessionEnded: true, token };
  }
  if (isWrite) {
    await db.exec('UPDATE sessions SET last_activity = now() WHERE token = $1', [token]);
  }
  return {
    user: { id: row.user_id, name: row.name, email: row.email, role: row.role as User['role'] },
    sessionEnded: false,
    token,
  };
}

export async function createSession(db: Db, userId: number): Promise<string> {
  const token = newToken();
  await db.exec('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.exec('DELETE FROM sessions WHERE token = $1', [token]);
}
