import { randomBytes } from 'node:crypto';
import { query } from './db/pool';

export type Role = 'owner' | 'hand' | 'maker';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const SESSION_COOKIE = 'kerfwell_session';
/** A readable marker, holding no credential, so the page knows whether to ask for the session. */
export const SIGNED_IN_COOKIE = 'kerfwell_signed_in';

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

export async function userForSession(sessionId: string | null): Promise<SessionUser | null> {
  if (sessionId === null) return null;
  const found = await query<SessionUser>(
    `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId]
  );
  return found[0] ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = randomBytes(24).toString('hex');
  await query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [sessionId, userId]);
  return sessionId;
}

export async function destroySession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export function sessionCookies(sessionId: string): string[] {
  return [`${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, `${SIGNED_IN_COOKIE}=1; Path=/; SameSite=Lax`];
}

export function clearedSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${SIGNED_IN_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`
  ];
}
