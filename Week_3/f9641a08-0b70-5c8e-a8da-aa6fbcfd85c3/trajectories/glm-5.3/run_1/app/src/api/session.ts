import type { Request, Response } from 'express';
import type { Client } from '../db/pool.js';
import { newToken } from '../domain/password.js';
import { Errors } from '../domain/errors.js';

export type SessionInfo = { token: string; userId: number | null; role: string | null; userName: string | null };

export const SESSION_COOKIE = 'rh_session';

/** Reads the session, creating a guest one when the request has no valid cookie. */
export async function readSession(req: Request, res: Response): Promise<SessionInfo> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    const info = await lookupSession(token);
    if (info) return info;
  }
  return createGuestSession(req, res);
}

export async function lookupSession(token: string): Promise<SessionInfo | null> {
  const { pool } = await import('../db/pool.js');
  const res = await pool.query<{ token: string; user_id: string | null; role: string | null; name: string | null }>(
    `SELECT s.token, s.user_id::TEXT AS user_id, u.role, u.name
     FROM sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`, [token]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { token: row.token, userId: row.user_id === null ? null : Number(row.user_id), role: row.role, userName: row.name ?? null };
}

async function createGuestSession(req: Request, res: Response): Promise<SessionInfo> {
  const token = newToken();
  const { pool } = await import('../db/pool.js');
  await pool.query(`INSERT INTO sessions (token) VALUES ($1)`, [token]);
  setSessionCookie(res, token);
  return { token, userId: null, role: null, userName: null };
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

export async function attachSession(client: Client, token: string, userId: number): Promise<void> {
  await client.query(`UPDATE sessions SET user_id = $1 WHERE token = $2`, [userId, token]);
}

export function requireSignedIn(session: SessionInfo): number {
  if (session.userId === null) throw Errors.unauthenticated();
  return session.userId;
}

export function requireStaff(session: SessionInfo, roles: string[]): number {
  if (session.userId === null || session.role === null || !roles.includes(session.role)) {
    throw Errors.forbidden();
  }
  return session.userId;
}
