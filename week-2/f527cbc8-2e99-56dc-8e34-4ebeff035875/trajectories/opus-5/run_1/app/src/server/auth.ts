import { queryOne, query, type Db } from './db.js';
import { now } from './clock.js';
import { newId, newToken, sha256, verifyPassword } from './util.js';
import type { Actor } from './audit.js';

export type Role = 'farrier' | 'apprentice' | 'owner' | 'barn_manager';
export type TokenScope = 'read_only' | 'billing';

export interface Caller {
  userId: string;
  name: string;
  email: string;
  role: Role;
  barnId: string | null;
  /** Set when the caller is an API token acting as the farrier. */
  tokenId: string | null;
  tokenScope: TokenScope | null;
  sessionId: string | null;
}

export function callerActor(caller: Caller): Actor {
  return caller.tokenId === null
    ? { type: 'user', id: caller.userId }
    : { type: 'token', id: caller.tokenId };
}

export const SESSION_COOKIE = 'clinchline_session';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  barn_id: string | null;
  password_hash: string;
}

export async function signIn(
  db: Db,
  email: string,
  password: string,
): Promise<{ caller: Caller; sessionId: string } | null> {
  const user = await queryOne<UserRow>(
    db,
    'SELECT id, name, email, role, barn_id, password_hash FROM users WHERE email_folded = $1',
    [email.trim().toLowerCase()],
  );
  if (user === null) return null;
  if (!(await verifyPassword(password, user.password_hash))) return null;
  const sessionId = newId();
  await query(db, 'INSERT INTO sessions (id, user_id, created_at) VALUES ($1,$2,$3)', [
    sessionId,
    user.id,
    now(),
  ]);
  return {
    sessionId,
    caller: {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      barnId: user.barn_id,
      tokenId: null,
      tokenScope: null,
      sessionId,
    },
  };
}

export async function callerFromSession(db: Db, sessionId: string): Promise<Caller | null> {
  const row = await queryOne<UserRow & { session_id: string }>(
    db,
    `SELECT u.id, u.name, u.email, u.role, u.barn_id, u.password_hash, s.id AS session_id
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  if (row === null) return null;
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    barnId: row.barn_id,
    tokenId: null,
    tokenScope: null,
    sessionId: row.session_id,
  };
}

/** An API token is used as a Bearer token and acts as the farrier. */
export async function callerFromToken(db: Db, token: string): Promise<Caller | null> {
  const row = await queryOne<UserRow & { token_id: string; scope: TokenScope }>(
    db,
    `SELECT u.id, u.name, u.email, u.role, u.barn_id, u.password_hash,
            t.id AS token_id, t.scope
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [sha256(token)],
  );
  if (row === null) return null;
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    barnId: row.barn_id,
    tokenId: row.token_id,
    tokenScope: row.scope,
    sessionId: null,
  };
}

export async function endSession(db: Db, sessionId: string): Promise<void> {
  await query(db, 'DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function sessionExists(db: Db, sessionId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(db, 'SELECT id FROM sessions WHERE id = $1', [sessionId]);
  return row !== null;
}

export interface CreatedApiToken {
  id: string;
  token: string;
  tokenHash: string;
}

export function mintApiToken(): CreatedApiToken {
  const token = `cl_${newToken(32)}`;
  return { id: newId(), token, tokenHash: sha256(token) };
}
