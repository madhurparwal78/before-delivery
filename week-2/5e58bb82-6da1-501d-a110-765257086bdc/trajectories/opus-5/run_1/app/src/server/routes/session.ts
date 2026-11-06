import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SIGN_IN_INCORRECT } from '../../shared/copy.js';
import { config, SESSION_HOURS } from '../config.js';
import { DECOY_PASSWORD_HASH, pool, verifyPassword, withTransaction } from '../db.js';
import { isSafePath, landingAddress, ROLE_HOME, type ScopeLookup } from '../domain/landing.js';
import {
  evaluateAttempt,
  normaliseEmail,
  recordFailure,
  retryAfterSeconds,
  tooManyAttemptsMessage,
  wholeSecondsIso,
  type AttemptRecord,
} from '../domain/signInLimit.js';
import { ApiError, validation } from '../errors.js';
import {
  jsonObject,
  requireUser,
  sendEmpty,
  sendJson,
  SESSION_COOKIE,
  type Ctx,
  type Router,
} from '../http.js';
import { currentStatus } from '../probes.js';
import { findUserByEmail, listOrgs, toUser, usersByRole } from '../repo.js';
import { staffOnly } from './guards.js';

/** Records a mission address as open, a vessel as existing, a survey as in scope. */
export const scopeLookup: ScopeLookup = {
  async missionOrgId(missionId) {
    const result = await pool.query<{ client_org_id: string }>(
      'SELECT client_org_id FROM missions WHERE id = $1',
      [missionId],
    );
    return result.rows[0]?.client_org_id ?? null;
  },
  async missionIsOpen(missionId) {
    const result = await pool.query<{ one: number }>(
      `SELECT 1 AS one FROM missions WHERE id = $1
         AND status IN ('Planned','Launched','Surveying','Recovering')`,
      [missionId],
    );
    return result.rows.length > 0;
  },
  async vesselExists(vesselId) {
    const result = await pool.query<{ one: number }>('SELECT 1 AS one FROM vessels WHERE id = $1', [
      vesselId,
    ]);
    return result.rows.length > 0;
  },
};

function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function attemptRecord(
  client: PoolClient,
  email: string,
): Promise<AttemptRecord> {
  await client.query(
    `INSERT INTO sign_in_attempts (email, fail_count) VALUES ($1, 0) ON CONFLICT (email) DO NOTHING`,
    [email],
  );
  const locked = await client.query<AttemptRecord>(
    `SELECT fail_count, window_started_at, locked_until FROM sign_in_attempts
     WHERE email = $1 FOR UPDATE`,
    [email],
  );
  return (
    locked.rows[0] ?? { fail_count: 0, window_started_at: null, locked_until: null }
  );
}

async function storeAttempt(
  client: PoolClient,
  email: string,
  record: AttemptRecord,
): Promise<void> {
  await client.query(
    `UPDATE sign_in_attempts SET fail_count = $2, window_started_at = $3, locked_until = $4
     WHERE email = $1`,
    [email, record.fail_count, record.window_started_at, record.locked_until],
  );
}

async function signIn(ctx: Ctx): Promise<void> {
  const body = jsonObject(ctx);
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const next = typeof body.next === 'string' ? body.next : null;

  // A body missing either credential answers 401 and is not counted.
  if (rawEmail.trim().length === 0 || password.length === 0) {
    throw new ApiError(401, 'invalid_credentials', SIGN_IN_INCORRECT);
  }
  const email = normaliseEmail(rawEmail);

  const outcome = await withTransaction(async (client) => {
    const stored = await attemptRecord(client, email);
    const decision = evaluateAttempt(stored, ctx.now, config.signInWindowSeconds);
    if (decision.locked && decision.retryAt) {
      return { kind: 'locked' as const, retryAt: decision.retryAt };
    }
    if (decision.next !== stored) await storeAttempt(client, email, decision.next);

    const user = await findUserByEmail(client, email);
    // An unknown address runs the same password check, so the timing matches.
    const ok = verifyPassword(password, user ? user.password_hash : DECOY_PASSWORD_HASH);
    if (!user || !ok) {
      await storeAttempt(
        client,
        email,
        recordFailure(decision.next, ctx.now, config.signInWindowSeconds),
      );
      return { kind: 'invalid' as const };
    }

    await storeAttempt(client, email, {
      fail_count: 0,
      window_started_at: null,
      locked_until: null,
    });
    const id = randomBytes(24).toString('hex');
    await client.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,$3)`,
      [id, user.id, new Date(ctx.now.getTime() + SESSION_HOURS * 3600 * 1000).toISOString()],
    );
    return { kind: 'signed-in' as const, user, sessionId: id };
  });

  if (outcome.kind === 'locked') {
    throw new ApiError(
      429,
      'too_many_attempts',
      tooManyAttemptsMessage(outcome.retryAt),
      { retry_at: wholeSecondsIso(outcome.retryAt) },
      { 'Retry-After': String(retryAfterSeconds(outcome.retryAt, ctx.now)) },
    );
  }
  if (outcome.kind === 'invalid') {
    throw new ApiError(401, 'invalid_credentials', SIGN_IN_INCORRECT);
  }

  const home = await landingAddress(
    next,
    outcome.user.last_screen,
    outcome.user.role,
    outcome.user.client_org_id,
    scopeLookup,
  );
  sendJson(ctx.res, 200, { user: toUser(outcome.user), home }, {
    'set-cookie': sessionCookie(outcome.sessionId),
  });
}

export function registerSessionRoutes(router: Router): void {
  router.add({ method: 'POST', pattern: '/api/session', body: 'json', auth: 'none', handler: signIn });

  router.add({
    method: 'POST',
    pattern: '/api/session/refresh',
    body: 'json',
    handler: async (ctx) => {
      await pool.query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [
        ctx.sessionId,
        new Date(ctx.now.getTime() + SESSION_HOURS * 3600 * 1000).toISOString(),
      ]);
      sendEmpty(ctx.res, 204);
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/session',
    body: 'none',
    handler: async (ctx) => {
      await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [ctx.sessionId]);
      sendEmpty(ctx.res, 204, { 'set-cookie': clearedCookie() });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/me',
    body: 'none',
    handler: async (ctx) => {
      sendJson(ctx.res, 200, toUser(requireUser(ctx)));
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/me',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const units = jsonObject(ctx).units;
      if (units !== 'metric' && units !== 'imperial') {
        throw validation({ units: 'Choose metric or imperial' });
      }
      const updated = await pool.query('UPDATE users SET units = $2 WHERE id = $1 RETURNING *', [
        user.id,
        units,
      ]);
      sendJson(ctx.res, 200, toUser(updated.rows[0]!));
    },
  });

  router.add({
    method: 'PUT',
    pattern: '/api/me/last-screen',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const path = jsonObject(ctx).path;
      if (
        typeof path !== 'string' ||
        !(await isSafePath(path, user.role, user.client_org_id, scopeLookup))
      ) {
        throw validation({ path: 'Send a screen address this role may open' });
      }
      await pool.query('UPDATE users SET last_screen = $2 WHERE id = $1', [user.id, path]);
      sendEmpty(ctx.res, 204);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/status',
    body: 'none',
    handler: async (ctx) => {
      sendJson(ctx.res, 200, await currentStatus(pool));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/health',
    body: 'none',
    auth: 'none',
    handler: async (ctx) => {
      sendJson(ctx.res, 200, { status: 'ok' });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/client-orgs',
    body: 'none',
    handler: async (ctx) => {
      staffOnly(requireUser(ctx));
      sendJson(ctx.res, 200, await listOrgs(pool));
    },
  });

  // The names the handover dialog offers; it carries no email or other field.
  router.add({
    method: 'GET',
    pattern: '/api/principal-surveyors',
    body: 'none',
    handler: async (ctx) => {
      staffOnly(requireUser(ctx));
      const surveyors = await usersByRole(pool, ['principal_surveyor']);
      sendJson(
        ctx.res,
        200,
        surveyors.map((surveyor) => ({ id: surveyor.id, name: surveyor.name })),
      );
    },
  });
}

export { ROLE_HOME };
