import { randomBytes } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../db/pool';
import { forbidden, unauthenticated } from '../errors';
import { Multipart } from './body';

export type SessionUser = { id: string; name: string; email: string; role: string };

export type Ctx = {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  sessionId: string;
  user: SessionUser | null;
  raw: Buffer;
  body: Record<string, unknown>;
  multipart: Multipart | null;
  cookies: Record<string, string>;
  setCookies: string[];
};

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(value: string): string {
  return `rh_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
}

export async function resolveSession(
  cookieValue: string | undefined
): Promise<{ sessionId: string; user: SessionUser | null; fresh: boolean }> {
  if (cookieValue !== undefined && cookieValue !== '') {
    const row = await db.one<{ id: string; user_id: string | null }>(
      'SELECT id, user_id FROM sessions WHERE id = $1',
      [cookieValue]
    );
    if (row !== null) {
      let user: SessionUser | null = null;
      if (row.user_id !== null) {
        user = await db.one<SessionUser>('SELECT id, name, email, role FROM users WHERE id = $1', [row.user_id]);
      }
      return { sessionId: row.id, user, fresh: false };
    }
  }
  const sessionId = randomBytes(24).toString('hex');
  await db.query('INSERT INTO sessions (id, user_id) VALUES ($1, NULL)', [sessionId]);
  return { sessionId, user: null, fresh: true };
}

export function requireUser(ctx: Ctx): SessionUser {
  if (ctx.user === null) throw unauthenticated();
  return ctx.user;
}

export function requireRole(ctx: Ctx, roles: string[]): SessionUser {
  const user = requireUser(ctx);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export function isStaff(user: SessionUser | null): boolean {
  return user !== null && (user.role === 'operations' || user.role === 'support');
}
