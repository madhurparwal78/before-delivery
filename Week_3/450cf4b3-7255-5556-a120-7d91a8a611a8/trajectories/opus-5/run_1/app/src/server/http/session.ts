import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { query, queryOne, type Db } from '../db';
import type { Role } from '../../shared/types';

export const SESSION_COOKIE = 'sh_session';

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  displayName: string;
  tenantId: string | null;
  sessionId: string;
  passwordConfirmedAt: Date | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(client: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(client, 'insert into sessions (id, token_hash, user_id) values ($1,$2,$3)', [
    randomUUID(),
    hashToken(token),
    userId,
  ]);
  return token;
}

export async function userForToken(client: Db, token: string): Promise<AuthUser | null> {
  const row = await queryOne<{
    session_id: string;
    password_confirmed_at: Date | null;
    id: string;
    role: Role;
    email: string;
    display_name: string;
    tenant_id: string | null;
  }>(
    client,
    `select s.id as session_id, s.password_confirmed_at, u.id, u.role, u.email, u.display_name, u.tenant_id
     from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [hashToken(token)],
  );
  if (row === null) return null;
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    displayName: row.display_name,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    passwordConfirmedAt: row.password_confirmed_at,
  };
}

export async function endSession(client: Db, token: string): Promise<void> {
  await query(client, 'delete from sessions where token_hash = $1', [hashToken(token)]);
}

export async function recordPasswordConfirmation(client: Db, sessionId: string): Promise<void> {
  await query(client, 'update sessions set password_confirmed_at = now() where id = $1', [sessionId]);
}
