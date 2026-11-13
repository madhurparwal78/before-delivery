import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { query, queryOne } from './db.js';
import { ApiError } from './errors.js';
import type { Ctx } from './http.js';
import { loadPlayer, type PlayerRow } from './players.js';

export const SESSION_COOKIE = 'hs_session';

export interface Session {
  sessionId: string;
  player: PlayerRow;
}

export async function startSession(playerId: string): Promise<string> {
  const id = randomUUID();
  await query(`INSERT INTO sessions (id, player_id) VALUES ($1, $2)`, [id, playerId]);
  return id;
}

export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function currentSession(ctx: Ctx): Promise<Session | null> {
  const sessionId = ctx.cookies[SESSION_COOKIE];
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const row = await queryOne<{ player_id: string }>(`SELECT player_id FROM sessions WHERE id = $1`, [sessionId]);
  if (!row) return null;
  const player = await loadPlayer(row.player_id);
  if (!player) return null;
  return { sessionId, player };
}

export async function requireSession(ctx: Ctx): Promise<Session> {
  const session = await currentSession(ctx);
  if (!session) throw ApiError.unauthenticated();
  return session;
}
