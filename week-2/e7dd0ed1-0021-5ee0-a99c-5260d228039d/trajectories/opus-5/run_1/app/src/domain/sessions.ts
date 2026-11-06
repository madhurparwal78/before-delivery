import type { PoolClient } from '../db';
import { one, query, rows } from '../db';
import { config } from '../config';
import { hashToken, randomId, randomToken } from '../crypto/seal';
import { nowSecond } from '../http/core';

export type SessionState = 'pending' | 'active' | 'ended';

export interface SessionRecord {
  id: string;
  user_id: string;
  state: string;
  device: string;
  created_at: string;
  last_seen_at: string;
  pending_expires_at: string | null;
  confirmed_until: string | null;
}

/** The single decision on whether a stored session is still usable. */
export function sessionState(session: SessionRecord, at: Date = new Date()): SessionState {
  if (session.state === 'ended') return 'ended';
  const created = new Date(session.created_at).getTime();
  const lastSeen = new Date(session.last_seen_at).getTime();
  const now = at.getTime();
  if (now >= created + config.timing.sessionLifetime * 1000) return 'ended';
  if (now >= lastSeen + config.timing.sessionIdle * 1000) return 'ended';
  if (session.state === 'pending') {
    const pendingEnd = session.pending_expires_at ? new Date(session.pending_expires_at).getTime() : 0;
    return now >= pendingEnd ? 'ended' : 'pending';
  }
  return 'active';
}

export function deviceName(userAgent: string | undefined): string {
  const trimmed = (userAgent ?? '').trim();
  return trimmed === '' ? 'Unknown device' : Array.from(trimmed).slice(0, 80).join('');
}

export interface IssuedSession {
  id: string;
  token: string;
}

export async function createSession(
  client: PoolClient,
  userId: string,
  options: { device: string; state: 'pending' | 'active' },
): Promise<IssuedSession> {
  const token = randomToken();
  const id = randomId('ses');
  const at = nowSecond();
  const pendingExpires =
    options.state === 'pending' ? new Date(at.getTime() + config.timing.twoStepPending * 1000).toISOString() : null;
  await client.query(
    `insert into sessions (id, token_hash, user_id, state, device, created_at, last_seen_at, pending_expires_at)
     values ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [id, hashToken(token), userId, options.state, options.device, at.toISOString(), pendingExpires],
  );
  return { id, token };
}

export async function endSession(client: PoolClient, id: string): Promise<void> {
  await client.query("update sessions set state = 'ended', ended_at = now() where id = $1", [id]);
}

export async function endOtherSessions(client: PoolClient, userId: string, keepSessionId: string): Promise<number> {
  const ended = await rows<{ id: string }>(
    client,
    "update sessions set state = 'ended', ended_at = now() where user_id = $1 and id <> $2 and state <> 'ended' returning id",
    [userId, keepSessionId],
  );
  return ended.length;
}

export async function findSessionByToken(token: string): Promise<SessionRecord | null> {
  return one<SessionRecord>(
    `select id, user_id, state, device, created_at, last_seen_at, pending_expires_at, confirmed_until
     from sessions where token_hash = $1`,
    [hashToken(token)],
  );
}

export async function touchSession(id: string): Promise<void> {
  await query('update sessions set last_seen_at = date_trunc(\'second\', now()) where id = $1', [id]);
}

export async function markEnded(id: string): Promise<void> {
  await query("update sessions set state = 'ended', ended_at = now() where id = $1 and state <> 'ended'", [id]);
}

export async function listSessions(userId: string): Promise<SessionRecord[]> {
  const stored = await query<SessionRecord>(
    `select id, user_id, state, device, created_at, last_seen_at, pending_expires_at, confirmed_until
     from sessions where user_id = $1 and state = 'active' order by last_seen_at desc`,
    [userId],
  );
  return stored.filter((session) => sessionState(session) === 'active');
}

/** Step-up confirmation: one session, lapsing at its exact second. */
export function isConfirmed(session: SessionRecord, at: Date = new Date()): boolean {
  if (!session.confirmed_until) return false;
  return at.getTime() < new Date(session.confirmed_until).getTime();
}

export async function setConfirmation(client: PoolClient, sessionId: string, until: Date): Promise<void> {
  await client.query('update sessions set confirmed_until = $2 where id = $1', [sessionId, until.toISOString()]);
}

export function sessionCookie(token: string): string {
  return `fs_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.timing.sessionLifetime}`;
}

export const clearedSessionCookie = 'fs_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
