// Sessions, sign-in lockout and account events. One implementation of each rule.

import type { PoolClient } from 'pg';
import { AppTimers, SIGNIN_IP_FAILURES, SIGNIN_PAIR_FAILURES } from '../shared/constants.js';
import { errors } from './errors.js';
import { newCsrfToken, newSessionId, sha256 } from './security.js';
import { dummyVerify, verifyPassword } from './passwords.js';

export interface Person {
  id: string;
  email: string;
  displayName: string;
}

export interface SessionInfo {
  sessionId: string;
  person: Person;
  csrfToken: string;
}

export interface RequestContext {
  client: PoolClient;
  ip: string;
  timers: AppTimers;
  now: Date;
}

// ---------------------------------------------------------------------------
// Sign-in lockout, checked before the password.

interface LockInfo {
  locked: boolean;
  retryAfter: number;
}

function retryAfterSeconds(lockUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((lockUntil.getTime() - now.getTime()) / 1000));
}

// The lock is counted from the failure that reached the threshold (the fifth
// for a pair, the twentieth for an IP), so attempts during a lock never
// extend it.
export async function pairLock(ctx: RequestContext, email: string): Promise<LockInfo> {
  const windowStart = new Date(ctx.now.getTime() - ctx.timers.signinWindowSeconds * 1000);
  const rows = await ctx.client.query<{ at: Date }>(
    `SELECT at FROM signin_failures
     WHERE lower(email) = lower($1) AND ip = $2 AND at >= $3
     ORDER BY at ASC`,
    [email, ctx.ip, windowStart],
  );
  const failures = rows.rows;
  if (failures.length >= SIGNIN_PAIR_FAILURES) {
    const fifth = failures[SIGNIN_PAIR_FAILURES - 1];
    const lockUntil = new Date(fifth.at.getTime() + ctx.timers.signinLockSeconds * 1000);
    if (lockUntil > ctx.now) return { locked: true, retryAfter: retryAfterSeconds(lockUntil, ctx.now) };
  }
  return { locked: false, retryAfter: 0 };
}

export async function ipLock(ctx: RequestContext): Promise<LockInfo> {
  const windowStart = new Date(ctx.now.getTime() - ctx.timers.signinWindowSeconds * 1000);
  const rows = await ctx.client.query<{ at: Date }>(
    `SELECT at FROM signin_failures
     WHERE ip = $1 AND at >= $2
     ORDER BY at ASC`,
    [ctx.ip, windowStart],
  );
  const failures = rows.rows;
  if (failures.length >= SIGNIN_IP_FAILURES) {
    const twentieth = failures[SIGNIN_IP_FAILURES - 1];
    const lockUntil = new Date(twentieth.at.getTime() + ctx.timers.signinLockSeconds * 1000);
    if (lockUntil > ctx.now) return { locked: true, retryAfter: retryAfterSeconds(lockUntil, ctx.now) };
  }
  return { locked: false, retryAfter: 0 };
}

// The longest applicable lock wins.
export async function checkLockout(ctx: RequestContext, email: string): Promise<void> {
  const pair = await pairLock(ctx, email);
  const ip = await ipLock(ctx);
  const pairWait = pair.locked ? pair.retryAfter : 0;
  const ipWait = ip.locked ? ip.retryAfter : 0;
  const wait = Math.max(pairWait, ipWait);
  if (wait > 0) throw errors.signinLocked(wait);
}

export async function recordFailure(ctx: RequestContext, email: string): Promise<boolean> {
  await ctx.client.query(
    'INSERT INTO signin_failures (email, ip, at) VALUES ($1, $2, $3)',
    [email.toLowerCase(), ctx.ip, ctx.now],
  );
  const pair = await pairLock(ctx, email);
  if (pair.locked) return true;
  const ip = await ipLock(ctx);
  return ip.locked;
}

// A successful sign-in clears that pair's failures.
export async function clearPairFailures(ctx: RequestContext, email: string): Promise<void> {
  await ctx.client.query(
    'DELETE FROM signin_failures WHERE lower(email) = lower($1) AND ip = $2',
    [email, ctx.ip],
  );
}

// Account audit events: signin.failed, signin.locked, password.changed.
export async function writeAccountEvent(
  ctx: { client: PoolClient; now: Date },
  personId: string | null,
  email: string,
  action: 'signin.failed' | 'signin.locked' | 'password.changed',
  detail: Record<string, unknown>,
): Promise<void> {
  await ctx.client.query(
    `INSERT INTO audit_events (at, actor, action, detail, person_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [ctx.now, email, action, JSON.stringify(detail), personId],
  );
}

// ---------------------------------------------------------------------------
// Sessions.

export async function findPersonByEmail(client: PoolClient, email: string): Promise<(Person & { passwordHash: string }) | null> {
  const rows = await client.query<{ id: string; email: string; display_name: string; password_hash: string }>(
    'SELECT id, email, display_name, password_hash FROM people WHERE lower(email) = lower($1)',
    [email],
  );
  if (rows.rowCount === 0) return null;
  const row = rows.rows[0];
  return { id: row.id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash };
}

export type SignInAttempt =
  | { ok: true; person: Person }
  | { ok: false; locked: boolean };

// A failed sign-in attempt: wrong email or wrong password. The failure and
// its audit events are recorded in the caller's transaction, so they are
// committed even though the request answers 401.
export async function attemptSignIn(ctx: RequestContext, email: string, password: string): Promise<SignInAttempt> {
  await checkLockout(ctx, email);
  const person = await findPersonByEmail(ctx.client, email);
  let ok = false;
  if (person) {
    ok = await verifyPassword(person.passwordHash, password);
  } else {
    await dummyVerify();
  }
  if (!ok || person === null) {
    const locked = await recordFailure(ctx, email);
    const personId = person ? person.id : null;
    await writeAccountEvent(ctx, personId, email.toLowerCase(), 'signin.failed', { ip: ctx.ip });
    if (locked) {
      await writeAccountEvent(ctx, personId, email.toLowerCase(), 'signin.locked', { ip: ctx.ip });
    }
    return { ok: false, locked };
  }
  await clearPairFailures(ctx, email);
  return { ok: true, person };
}

// Create a session, deleting any session the request already carried.
export async function createSession(ctx: RequestContext, personId: string, existingSessionHash: string | null): Promise<SessionInfo> {
  if (existingSessionHash) {
    await ctx.client.query('DELETE FROM sessions WHERE id_hash = $1', [existingSessionHash]);
  }
  const sessionId = newSessionId();
  const csrfToken = newCsrfToken();
  await ctx.client.query(
    `INSERT INTO sessions (id_hash, person_id, csrf_token, created_at, last_used_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [sha256(sessionId), personId, csrfToken, ctx.now],
  );
  const rows = await ctx.client.query<{ email: string; display_name: string }>(
    'SELECT email, display_name FROM people WHERE id = $1',
    [personId],
  );
  return {
    sessionId,
    csrfToken,
    person: { id: personId, email: rows.rows[0].email, displayName: rows.rows[0].display_name },
  };
}

// Sign-out and password change end every session of that person, everywhere.
export async function endAllSessions(client: PoolClient, personId: string): Promise<void> {
  await client.query('DELETE FROM sessions WHERE person_id = $1', [personId]);
}

export interface LoadedSession {
  session: SessionInfo;
  expired: boolean;
}

// Load the request's session; null when there is none. An expired session
// keeps its row so it answers session_expired until it is replaced.
export async function loadSession(ctx: RequestContext, cookieValue: string | undefined): Promise<LoadedSession | null> {
  if (!cookieValue) return null;
  const idHash = sha256(cookieValue);
  const rows = await ctx.client.query<{
    person_id: string;
    csrf_token: string;
    created_at: Date;
    last_used_at: Date;
    email: string;
    display_name: string;
  }>(
    `SELECT s.person_id, s.csrf_token, s.created_at, s.last_used_at, p.email, p.display_name
     FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.id_hash = $1`,
    [idHash],
  );
  if (rows.rowCount === 0) return null;
  const row = rows.rows[0];
  const idleExpired = ctx.now.getTime() - row.last_used_at.getTime() > ctx.timers.sessionIdleSeconds * 1000;
  const absoluteExpired = ctx.now.getTime() - row.created_at.getTime() > ctx.timers.sessionAbsoluteSeconds * 1000;
  if (idleExpired || absoluteExpired) {
    return {
      session: {
        sessionId: cookieValue,
        csrfToken: row.csrf_token,
        person: { id: row.person_id, email: row.email, displayName: row.display_name },
      },
      expired: true,
    };
  }
  await ctx.client.query('UPDATE sessions SET last_used_at = $1 WHERE id_hash = $2', [ctx.now, idHash]);
  return {
    session: {
      sessionId: cookieValue,
      csrfToken: row.csrf_token,
      person: { id: row.person_id, email: row.email, displayName: row.display_name },
    },
    expired: false,
  };
}
