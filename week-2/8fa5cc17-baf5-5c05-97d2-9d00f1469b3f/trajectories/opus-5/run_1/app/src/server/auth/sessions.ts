import { randomBytes, randomUUID } from 'node:crypto';
import { query, queryOne, Tx, withTransaction } from '../db/pool';
import { SessionRecord, labelFromUserAgent } from '../http/core';
import { config } from '../config';
import { LiveEvent, publishSessionEnded, recordEvents, publish } from '../events';
import { lockoutState, LOCKOUT_ADDRESS_FAILURES, LOCKOUT_EMAIL_FAILURES } from '../../shared/rules';

export const SESSION_COOKIE = 'quire_session';

type SessionRow = {
  id: string;
  secret: string;
  csrf_token: string;
  label: string;
  created_at: Date;
  last_seen_at: Date;
  ended_at: Date | null;
};

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    secret: row.secret,
    csrfToken: row.csrf_token,
    label: row.label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function sessionCookieHeader(secret: string): string {
  return `${SESSION_COOKIE}=${secret}; HttpOnly; SameSite=Lax; Path=/`;
}

export async function createSession(userAgent: string | undefined): Promise<SessionRecord> {
  const secret = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const label = labelFromUserAgent(userAgent);
  const rows = await query<SessionRow>(
    `insert into device_session (id, secret, csrf_token, label)
     values ($1, $2, $3, $4)
     returning id, secret, csrf_token, label, created_at, last_seen_at, ended_at`,
    [randomUUID(), secret, csrfToken, label],
  );
  await emitSessionsChanged();
  return toRecord(rows[0]);
}

/** A device session ends after the configured idle period with no request. */
export async function loadLiveSession(secret: string | undefined): Promise<SessionRecord | null> {
  if (secret === undefined || secret === '') return null;
  const row = await queryOne<SessionRow>(
    `select id, secret, csrf_token, label, created_at, last_seen_at, ended_at
       from device_session where secret = $1`,
    [secret],
  );
  if (row === null || row.ended_at !== null) return null;
  const idleMs = config.sessionIdleSeconds * 1000;
  if (Date.now() - row.last_seen_at.getTime() >= idleMs) {
    await endSessions([row.id]);
    return null;
  }
  await query('update device_session set last_seen_at = now() where id = $1', [row.id]);
  return toRecord(row);
}

export async function endSessions(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await query('update device_session set ended_at = now() where id = any($1::uuid[]) and ended_at is null', [
    sessionIds,
  ]);
  await query('delete from presence where session_id = any($1::uuid[])', [sessionIds]);
  publishSessionEnded(sessionIds);
  await emitSessionsChanged();
}

export async function rotateSession(sessionId: string): Promise<SessionRecord> {
  const secret = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const rows = await query<SessionRow>(
    `update device_session set secret = $2, csrf_token = $3, last_seen_at = now()
      where id = $1
      returning id, secret, csrf_token, label, created_at, last_seen_at, ended_at`,
    [sessionId, secret, csrfToken],
  );
  await emitSessionsChanged();
  return toRecord(rows[0]);
}

export async function liveSessions(currentId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<SessionRow>(
    `select id, secret, csrf_token, label, created_at, last_seen_at, ended_at
       from device_session
      where ended_at is null and last_seen_at > now() - ($1 || ' seconds')::interval
      order by created_at desc`,
    [String(config.sessionIdleSeconds)],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    created_at: row.created_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    current: row.id === currentId,
  }));
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    'select id from device_session where id = $1 and ended_at is null',
    [sessionId],
  );
  return row !== null;
}

export async function emitSessionsChanged(): Promise<void> {
  const events: LiveEvent[] = [{ type: 'sessions.changed', data: {} }];
  const stored = await withTransaction(async (tx: Tx) => recordEvents(tx, events));
  publish(stored);
}

/* --------------------------------------------------------------- lockout */

export type LockoutDecision = { locked: boolean; retryAfterSeconds: number };

async function failureTimes(kind: 'email' | 'address', identity: string): Promise<Date[]> {
  const rows = await query<{ created_at: Date }>(
    `select created_at from sign_in_failure
      where kind = $1 and identity = $2 and created_at > now() - ($3 || ' seconds')::interval`,
    [kind, identity, String(config.lockoutWindowSeconds)],
  );
  return rows.map((row) => row.created_at);
}

export async function checkLockout(email: string, address: string): Promise<LockoutDecision> {
  const emailState = lockoutState({
    failureTimes: await failureTimes('email', email),
    windowSeconds: config.lockoutWindowSeconds,
    now: new Date(),
    threshold: LOCKOUT_EMAIL_FAILURES,
  });
  if (emailState.locked) return emailState;
  return lockoutState({
    failureTimes: await failureTimes('address', address),
    windowSeconds: config.lockoutWindowSeconds,
    now: new Date(),
    threshold: LOCKOUT_ADDRESS_FAILURES,
  });
}

export async function recordFailure(email: string, address: string): Promise<void> {
  await query('insert into sign_in_failure (identity, kind) values ($1, $2), ($3, $4)', [
    email,
    'email',
    address,
    'address',
  ]);
}

export async function clearFailures(email: string): Promise<void> {
  await query('delete from sign_in_failure where kind = $1 and identity = $2', ['email', email]);
}
