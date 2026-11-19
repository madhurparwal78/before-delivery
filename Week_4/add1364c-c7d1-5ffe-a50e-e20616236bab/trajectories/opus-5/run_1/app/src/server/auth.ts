import { config } from './config.js';
import { now } from './clock.js';
import { copy } from './copy.js';
import { ApiError } from './errors.js';
import { one, query } from './db.js';
import { sendTo } from './events.js';
import { nextOfficeTimeAfter } from './officeTime.js';
import { newSessionId } from './secretStore.js';
import type { Caller } from './http.js';
import type { PersonRow, SessionRow } from './types.js';

export const CUT_OFF_OFFICE_TIME = '19:00';

export function sessionEndsAt(startedAt: Date): Date {
  const byLength = new Date(startedAt.getTime() + config.revealSessionSeconds * 1_000);
  const byCutOff = nextOfficeTimeAfter(startedAt, CUT_OFF_OFFICE_TIME);
  return byLength.getTime() <= byCutOff.getTime() ? byLength : byCutOff;
}

export function signedOut(): ApiError {
  return new ApiError(401, 'signed_out', copy.signedOut);
}

export function sessionEnded(): ApiError {
  return new ApiError(401, 'session_ended', copy.sessionEnded);
}

export async function authenticate(cookieValue: string | null): Promise<{ caller: Caller } | { refusal: ApiError }> {
  if (cookieValue === null) return { refusal: signedOut() };
  const row = await one<
    PersonRow & { session_id: string; session_created_at: Date; session_ends_at: Date; session_signed_out_at: Date | null }
  >(
    `select p.*, s.id as session_id, s.created_at as session_created_at,
            s.ends_at as session_ends_at, s.signed_out_at as session_signed_out_at
       from sessions s join people p on p.id = s.person_id
      where s.id = $1`,
    [cookieValue],
  );
  if (row === null) return { refusal: signedOut() };
  if (row.session_signed_out_at !== null || row.left_at !== null || !row.keycloak_enabled) {
    return { refusal: signedOut() };
  }
  const session: SessionRow = {
    id: row.session_id,
    person_id: row.id,
    created_at: row.session_created_at,
    ends_at: row.session_ends_at,
    signed_out_at: null,
  };
  if (now().getTime() >= session.ends_at.getTime()) return { refusal: sessionEnded() };
  return { caller: { person: row, session } };
}

export function sessionCookie(id: string, endsAt: Date): string {
  const maxAge = Math.max(1, Math.ceil((endsAt.getTime() - now().getTime()) / 1_000));
  return `lockset_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedCookie(): string {
  return 'lockset_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export async function startSession(personId: string): Promise<SessionRow> {
  const startedAt = now();
  const endsAt = sessionEndsAt(startedAt);
  const id = newSessionId();
  await query('insert into sessions (id, person_id, created_at, ends_at) values ($1,$2,$3,$4)', [
    id,
    personId,
    startedAt,
    endsAt,
  ]);
  return { id, person_id: personId, created_at: startedAt, ends_at: endsAt, signed_out_at: null };
}

/** A leave or a term end ends every Lockset session the person holds. */
export async function endSessionsFor(personId: string): Promise<void> {
  await query('update sessions set signed_out_at = $2 where person_id = $1 and signed_out_at is null', [
    personId,
    now(),
  ]);
  sendTo([personId], { name: 'access-changed', data: { vault_ids: [], ended: [], cause: 'change' } });
}

export type LockState = { locked: boolean; reopensAt: Date | null };

type SignInStateRow = { handle: string; failed_at: Date[]; locked_until: Date | null };

export async function lockStateFor(handle: string): Promise<LockState> {
  const row = await one<SignInStateRow>('select * from sign_in_state where handle = $1', [handle]);
  if (row === null || row.locked_until === null) return { locked: false, reopensAt: null };
  if (row.locked_until.getTime() <= now().getTime()) return { locked: false, reopensAt: null };
  return { locked: true, reopensAt: row.locked_until };
}

export function lockedRefusal(reopensAt: Date): ApiError {
  const seconds = Math.max(1, Math.ceil((reopensAt.getTime() - now().getTime()) / 1_000));
  return new ApiError(429, 'sign_in_locked', copy.signInLocked(reopensAt), {
    headers: { 'retry-after': String(seconds) },
  });
}

/** Five failures within the lock window lock the handle, whether or not it is on record. */
export async function recordSignInFailure(handle: string): Promise<void> {
  const at = now();
  const windowStart = new Date(at.getTime() - config.signInLockSeconds * 1_000);
  const row = await one<SignInStateRow>('select * from sign_in_state where handle = $1', [handle]);
  const recent = (row?.failed_at ?? []).filter((stamp) => stamp.getTime() > windowStart.getTime());
  recent.push(at);
  if (recent.length >= 5) {
    const lockedUntil = new Date(at.getTime() + config.signInLockSeconds * 1_000);
    await query(
      `insert into sign_in_state (handle, failed_at, locked_until) values ($1, '{}', $2)
         on conflict (handle) do update set failed_at = '{}', locked_until = $2`,
      [handle, lockedUntil],
    );
    return;
  }
  await query(
    `insert into sign_in_state (handle, failed_at, locked_until) values ($1, $2, null)
       on conflict (handle) do update set failed_at = $2, locked_until = null`,
    [handle, recent],
  );
}

export async function clearSignInFailures(handle: string): Promise<void> {
  await query('delete from sign_in_state where handle = $1', [handle]);
}
