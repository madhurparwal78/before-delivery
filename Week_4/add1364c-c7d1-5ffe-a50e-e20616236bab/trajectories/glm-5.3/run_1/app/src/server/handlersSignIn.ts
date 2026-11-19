import type { Ctx } from './apiRoutes.js';
import { ApiError, invalid } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { SignInLockout, sessionEnd } from './domain/sessions.js';
import { termIsOpen } from './domain/visibility.js';
import { loadPersonSnapshot, personView, decideLanding } from './handlersPeople.js';
import { randomUUID } from 'node:crypto';
import { formatOfficeStamp } from './officeTime.js';

/** Sign in: check the lockout, verify with Keycloak, create a session, decide the landing route. */
export async function signIn(ctx: Ctx, lockout: SignInLockout): Promise<void> {
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = {
    username: { type: 'string', required: true },
    password: { type: 'string', required: true },
    next: { type: 'string', required: false }
  };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const now = ctx.store.clock.now();
  const lock = await lockout.lockState(username, now);
  if (lock.locked && lock.until) {
    const retryAfter = Math.max(1, Math.ceil((lock.until.getTime() - now.getTime()) / 1000));
    throw new ApiError(
      429,
      'sign_in_locked',
      `${COPY.lockedPrefix}${formatOfficeStamp(lock.until)}.`,
      undefined,
      { 'Retry-After': String(retryAfter) }
    );
  }
  const officeKey = ctx.store.settings.officeKey;
  const keycloakUsername = `${officeKey}.${username}`;
  const check = await ctx.store.keycloak.checkPassword(keycloakUsername, password);
  if (check.kind === 'unreachable') {
    throw new ApiError(503, 'sign_in_unavailable', COPY.signInUnavailable);
  }
  if (check.kind === 'bad_credentials') {
    const fail = await lockout.recordFailure(username, now);
    if (fail.locked && fail.until) {
      const retryAfter = Math.max(1, Math.ceil((fail.until.getTime() - now.getTime()) / 1000));
      throw new ApiError(
        429,
        'sign_in_locked',
        `${COPY.lockedPrefix}${formatOfficeStamp(fail.until)}.`,
        undefined,
        { 'Retry-After': String(retryAfter) }
      );
    }
    throw new ApiError(401, 'bad_credentials', COPY.signInBadCredentials);
  }
  if (check.kind === 'account_disabled') {
    throw new ApiError(401, 'account_disabled', COPY.signInDisabled);
  }
  const rows = await ctx.store.pool.query("SELECT * FROM people WHERE handle = $1 AND status <> 'left'", [username]);
  if (rows.rows.length === 0) {
    // A handle that is on record only in another office answers bad_credentials.
    const fail = await lockout.recordFailure(username, now);
    if (fail.locked && fail.until) {
      const retryAfter = Math.max(1, Math.ceil((fail.until.getTime() - now.getTime()) / 1000));
      throw new ApiError(
        429,
        'sign_in_locked',
        `${COPY.lockedPrefix}${formatOfficeStamp(fail.until)}.`,
        undefined,
        { 'Retry-After': String(retryAfter) }
      );
    }
    throw new ApiError(401, 'bad_credentials', COPY.signInBadCredentials);
  }
  const personRow = rows.rows[0];
  const person = {
    id: String(personRow.id),
    full_name: String(personRow.full_name),
    email: String(personRow.email),
    handle: String(personRow.handle),
    role: personRow.role as never,
    status: String(personRow.status),
    aliases: (personRow.aliases as string[]) ?? [],
    term_starts_on: personRow.term_starts_on ? String(personRow.term_starts_on).slice(0, 10) : null,
    term_ends_on: personRow.term_ends_on ? String(personRow.term_ends_on).slice(0, 10) : null,
    left_at: personRow.left_at ? new Date(personRow.left_at as string) : null,
    first_signed_in_at: personRow.first_signed_in_at ? new Date(personRow.first_signed_in_at as string) : null
  };
  if (person.role === 'outside_bookkeeper' && !termIsOpen(person, now)) {
    throw new ApiError(401, 'account_disabled', COPY.signInDisabled);
  }
  await lockout.reset(username);
  const sessionId = randomUUID();
  const startedAt = now;
  const endsAt = sessionEnd(startedAt, ctx.store.settings.revealSessionSeconds);
  await ctx.store.pool.query(
    'INSERT INTO sessions (id, person_id, started_at, ends_at) VALUES ($1,$2,$3,$4)',
    [sessionId, person.id, startedAt, endsAt]
  );
  await ctx.store.pool.query('UPDATE people SET first_signed_in_at = COALESCE(first_signed_in_at, $2) WHERE id = $1', [
    person.id,
    startedAt
  ]);
  const landing = await decideLanding(ctx, person, typeof body.next === 'string' ? body.next : undefined);
  const snap = await loadPersonSnapshot(ctx, person.id);
  jsonOk(
    ctx.res,
    201,
    {
      person: personView(snap),
      session_ends_at: endsAt.toISOString(),
      landing
    },
    {
      'Set-Cookie': `lockset_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`,
      'Cache-Control': 'no-store'
    }
  );
}
