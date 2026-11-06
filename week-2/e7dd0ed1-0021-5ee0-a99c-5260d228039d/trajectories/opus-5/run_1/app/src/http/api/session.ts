import type { PoolClient } from '../../db';
import { query, transaction } from '../../db';
import { config, limits } from '../../config';
import { apiError, validation } from '../../errors';
import { isoSecond } from '../../format';
import { hashPassword, hashToken, verifyPassword } from '../../crypto/seal';
import { newRecoveryCodes, otpauthUri, randomTwoStepSecret } from '../../crypto/totp';
import { header, nowSecond, onlyFields, readJsonBody, requireXRequestedWith, sendJson, sendNoContent } from '../core';
import { loadMemberships, requireActive, resolveCaller } from '../../domain/auth';
import { appendAuditForUser } from '../../domain/audit';
import {
  clearedSessionCookie,
  createSession,
  deviceName,
  endOtherSessions,
  endSession,
  listSessions,
  sessionCookie,
  sessionState,
  setConfirmation,
} from '../../domain/sessions';
import { checkSignInThrottle, clearSignInFailures, recordSignInFailure } from '../../domain/throttle';
import {
  acceptAuthenticatorCode,
  acceptRecoveryCode,
  codeFieldMessages,
  loadTwoStep,
  recoveryCodesLeft,
  sealSecret,
  storeRecoveryCodes,
} from '../../domain/twostep';
import { mailPasswordChanged, mailTwoStepOff, mailTwoStepOn } from '../../domain/notifications';
import { isValidNewPassword, passwordMessage } from '../../domain/members';
import type { Router } from '../router';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_operator: boolean;
  two_step_state: string;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const found = await query<UserRow>(
    'select id, name, email, password_hash, is_operator, two_step_state from users where lower(email) = lower($1)',
    [email],
  );
  return found[0] ?? null;
}

async function identityBody(user: { id: string; name: string; email: string; is_operator: boolean }): Promise<Record<string, unknown>> {
  const memberships = await loadMemberships(user.id);
  return {
    user: { id: user.id, name: user.name, email: user.email, operator: user.is_operator === true },
    memberships: memberships.map((membership) => ({
      workspace: { slug: membership.slug, name: membership.name },
      role: membership.role,
    })),
  };
}

function requireStringFields(body: Record<string, unknown>, fields: string[]): void {
  const failures: Record<string, string> = onlyFields(body, fields);
  for (const field of fields) {
    if (typeof body[field] !== 'string') failures[field] = 'This field is required.';
  }
  if (Object.keys(failures).length > 0) throw validation(failures);
}

function exactlyOneCode(body: Record<string, unknown>): { code?: string; recoveryCode?: string } {
  const extra = onlyFields(body, ['code', 'recovery_code']);
  if (Object.keys(extra).length > 0) throw validation(extra);
  const code = typeof body.code === 'string' && body.code !== '' ? body.code : undefined;
  const recoveryCode = typeof body.recovery_code === 'string' && body.recovery_code !== '' ? body.recovery_code : undefined;
  if ((code === undefined) === (recoveryCode === undefined)) throw validation({ code: codeFieldMessages.oneOf });
  return { code, recoveryCode };
}

async function endSessionByToken(client: PoolClient, token: string | undefined): Promise<void> {
  if (!token) return;
  const found = await client.query('select id from sessions where token_hash = $1', [hashToken(token)]);
  if (found.rowCount === 0) return;
  await endSession(client, found.rows[0].id as string);
}

export function registerSessionRoutes(router: Router): void {
  router.get('/api/health', async (ctx) => {
    sendJson(ctx, 200, { status: 'ok' });
  });

  router.get('/api/regions', async (ctx) => {
    const regions = await query<{ id: string; name: string; continent: string; lon: string; lat: string }>(
      'select id, name, continent, lon::text as lon, lat::text as lat from regions order by id',
    );
    sendJson(ctx, 200, {
      regions: regions.map((region) => ({
        id: region.id,
        name: region.name,
        continent: region.continent,
        lon: Number(region.lon),
        lat: Number(region.lat),
      })),
    });
  });

  router.post('/api/session', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const email = typeof body.email === 'string' ? body.email : '';
    if (email !== '') await checkSignInThrottle(email);
    requireXRequestedWith(ctx);
    requireStringFields(body, ['email', 'password']);
    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(body.password as string, user.password_hash)) {
      await recordSignInFailure(email);
      if (user) {
        await transaction(async (client) =>
          appendAuditForUser(client, user.id, {
            actor: user.email,
            action: 'session.sign_in_failed',
            target: user.email,
            detail: 'password',
          }),
        );
      }
      throw apiError('invalid_credentials', 'Email or password is incorrect.');
    }
    const incoming = ctx.cookies.fs_session;
    if (user.two_step_state === 'on') {
      const issued = await transaction(async (client) => {
        await endSessionByToken(client, incoming);
        return createSession(client, user.id, { device: deviceName(header(ctx, 'user-agent')), state: 'pending' });
      });
      sendJson(
        ctx,
        202,
        { two_step: 'required', expires_at: isoSecond(new Date(Date.now() + config.timing.twoStepPending * 1000)) },
        { 'Set-Cookie': sessionCookie(issued.token) },
      );
      return;
    }
    const issued = await transaction(async (client) => {
      await endSessionByToken(client, incoming);
      const created = await createSession(client, user.id, { device: deviceName(header(ctx, 'user-agent')), state: 'active' });
      await appendAuditForUser(client, user.id, {
        actor: user.email,
        action: 'session.signed_in',
        target: user.email,
        detail: 'password',
      });
      return created;
    });
    await clearSignInFailures(email);
    sendJson(ctx, 200, await identityBody(user), { 'Set-Cookie': sessionCookie(issued.token) });
  });

  router.post('/api/session/two-step', async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (caller.kind !== 'pending') throw apiError('unauthenticated');
    const body = await readJsonBody(ctx, limits.jsonBody);
    const given = exactlyOneCode(body);
    const found = await query<UserRow>(
      'select id, name, email, password_hash, is_operator, two_step_state from users where id = $1',
      [caller.session.user_id],
    );
    const user = found[0];
    await checkSignInThrottle(user.email);
    requireXRequestedWith(ctx);
    const issued = await transaction(async (client) => {
      const twoStep = await loadTwoStep(client, user.id);
      if (!twoStep) return null;
      const accepted =
        given.code !== undefined
          ? await acceptAuthenticatorCode(client, twoStep, given.code)
          : await acceptRecoveryCode(client, user.id, given.recoveryCode as string);
      if (!accepted) return null;
      await endSession(client, caller.session.id);
      const created = await createSession(client, user.id, { device: deviceName(header(ctx, 'user-agent')), state: 'active' });
      await appendAuditForUser(client, user.id, {
        actor: user.email,
        action: 'session.signed_in',
        target: user.email,
        detail: given.code !== undefined ? 'two-step' : 'recovery code',
      });
      return created;
    });
    if (!issued) {
      await recordSignInFailure(user.email);
      await transaction(async (client) =>
        appendAuditForUser(client, user.id, {
          actor: user.email,
          action: 'session.sign_in_failed',
          target: user.email,
          detail: 'two-step code',
        }),
      );
      throw apiError('invalid_credentials', "That code didn't work.");
    }
    await clearSignInFailures(user.email);
    sendJson(ctx, 200, await identityBody(user), { 'Set-Cookie': sessionCookie(issued.token) });
  });

  router.delete('/api/session', async (ctx) => {
    requireXRequestedWith(ctx);
    const caller = await resolveCaller(ctx);
    if (caller.kind !== 'anonymous') {
      const sessionId = caller.kind === 'pending' ? caller.session.id : caller.principal.session.id;
      await transaction(async (client) => endSession(client, sessionId));
    }
    sendNoContent(ctx, { 'Set-Cookie': clearedSessionCookie });
  });

  router.get('/api/me', async (ctx) => {
    const principal = requireActive(await resolveCaller(ctx));
    sendJson(ctx, 200, await identityBody(principal.user));
  });

  router.get('/api/me/two-step', async (ctx) => {
    const principal = requireActive(await resolveCaller(ctx));
    const state = await transaction(async (client) => {
      const twoStep = await loadTwoStep(client, principal.user.id);
      return {
        enabled: twoStep?.two_step_state === 'on',
        enabled_at: twoStep?.two_step_enabled_at ? isoSecond(twoStep.two_step_enabled_at) : null,
        recovery_codes_left: await recoveryCodesLeft(client, principal.user.id),
      };
    });
    sendJson(ctx, 200, state);
  });

  router.post('/api/me/two-step/setup', async (ctx) => {
    requireXRequestedWith(ctx);
    const principal = requireActive(await resolveCaller(ctx));
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, []);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const secret = randomTwoStepSecret();
    await transaction(async (client) => {
      const twoStep = await loadTwoStep(client, principal.user.id);
      if (twoStep?.two_step_state === 'on') {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: 'on', to: 'on' });
      }
      await client.query("update users set two_step_state = 'setup', two_step_setup_sealed = $2 where id = $1", [
        principal.user.id,
        sealSecret(secret),
      ]);
    });
    sendJson(ctx, 200, { secret, otpauth_uri: otpauthUri(principal.user.email, secret) });
  });

  router.post('/api/me/two-step/enable', async (ctx) => {
    requireXRequestedWith(ctx);
    const principal = requireActive(await resolveCaller(ctx));
    const body = await readJsonBody(ctx, limits.jsonBody);
    requireStringFields(body, ['code']);
    const codes = newRecoveryCodes();
    const enabledAt = nowSecond();
    await transaction(async (client) => {
      const twoStep = await loadTwoStep(client, principal.user.id);
      if (!twoStep || twoStep.two_step_state !== 'setup') {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: 'off', to: 'on' });
      }
      if (!(await acceptAuthenticatorCode(client, twoStep, body.code as string, { useSetupSecret: true }))) {
        throw validation({ code: codeFieldMessages.wrongCode });
      }
      await client.query(
        `update users set two_step_state = 'on', two_step_secret_sealed = two_step_setup_sealed, two_step_setup_sealed = null,
           two_step_enabled_at = $2 where id = $1`,
        [principal.user.id, enabledAt.toISOString()],
      );
      await storeRecoveryCodes(client, principal.user.id, codes);
      await appendAuditForUser(client, principal.user.id, {
        actor: principal.user.email,
        action: 'two_step.enabled',
        target: principal.user.email,
        detail: '',
      });
      await mailTwoStepOn(client, principal.user.email, enabledAt);
    });
    sendJson(ctx, 200, { recovery_codes: codes });
  });

  router.delete('/api/me/two-step', async (ctx) => {
    const principal = requireActive(await resolveCaller(ctx));
    const body = await readJsonBody(ctx, limits.jsonBody);
    const given = exactlyOneCode(body);
    await checkSignInThrottle(principal.user.email);
    requireXRequestedWith(ctx);
    const turnedOffAt = nowSecond();
    const accepted = await transaction(async (client) => {
      const twoStep = await loadTwoStep(client, principal.user.id);
      if (!twoStep || twoStep.two_step_state !== 'on') {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: 'off', to: 'off' });
      }
      const ok =
        given.code !== undefined
          ? await acceptAuthenticatorCode(client, twoStep, given.code)
          : await acceptRecoveryCode(client, principal.user.id, given.recoveryCode as string);
      if (!ok) return false;
      await client.query(
        `update users set two_step_state = 'off', two_step_secret_sealed = null, two_step_setup_sealed = null,
           two_step_enabled_at = null where id = $1`,
        [principal.user.id],
      );
      await client.query('delete from recovery_codes where user_id = $1', [principal.user.id]);
      await appendAuditForUser(client, principal.user.id, {
        actor: principal.user.email,
        action: 'two_step.disabled',
        target: principal.user.email,
        detail: '',
      });
      await mailTwoStepOff(client, principal.user.email, turnedOffAt);
      return true;
    });
    if (!accepted) {
      await recordSignInFailure(principal.user.email);
      throw validation(
        given.code !== undefined ? { code: codeFieldMessages.wrongCode } : { recovery_code: codeFieldMessages.wrongRecovery },
      );
    }
    sendNoContent(ctx);
  });

  router.post('/api/me/two-step/confirm', async (ctx) => {
    const principal = requireActive(await resolveCaller(ctx));
    const body = await readJsonBody(ctx, limits.jsonBody);
    const given = exactlyOneCode(body);
    await checkSignInThrottle(principal.user.email);
    requireXRequestedWith(ctx);
    const until = new Date(nowSecond().getTime() + config.timing.stepUp * 1000);
    const accepted = await transaction(async (client) => {
      const twoStep = await loadTwoStep(client, principal.user.id);
      if (!twoStep || twoStep.two_step_state !== 'on') {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
          from: 'off',
          to: 'confirmed',
        });
      }
      const ok =
        given.code !== undefined
          ? await acceptAuthenticatorCode(client, twoStep, given.code)
          : await acceptRecoveryCode(client, principal.user.id, given.recoveryCode as string);
      if (!ok) return false;
      await setConfirmation(client, principal.session.id, until);
      return true;
    });
    if (!accepted) {
      await recordSignInFailure(principal.user.email);
      throw validation(
        given.code !== undefined ? { code: codeFieldMessages.wrongCode } : { recovery_code: codeFieldMessages.wrongRecovery },
      );
    }
    sendJson(ctx, 200, { confirmed_until: isoSecond(until) });
  });

  router.get('/api/me/sessions', async (ctx) => {
    const principal = requireActive(await resolveCaller(ctx));
    const sessions = await listSessions(principal.user.id);
    sendJson(ctx, 200, {
      sessions: sessions.map((session) => ({
        id: session.id,
        device: session.device,
        created_at: isoSecond(session.created_at),
        last_seen_at: isoSecond(session.last_seen_at),
        current: session.id === principal.session.id,
      })),
    });
  });

  router.delete('/api/me/sessions/:id', async (ctx) => {
    requireXRequestedWith(ctx);
    const principal = requireActive(await resolveCaller(ctx));
    const found = await query<{
      id: string;
      user_id: string;
      state: string;
      device: string;
      created_at: string;
      last_seen_at: string;
      pending_expires_at: string | null;
      confirmed_until: string | null;
    }>(
      `select id, user_id, state, device, created_at, last_seen_at, pending_expires_at, confirmed_until
       from sessions where id = $1`,
      [ctx.params.id],
    );
    const target = found[0];
    if (!target || target.user_id !== principal.user.id || sessionState(target) === 'ended') throw apiError('not_found');
    await transaction(async (client) => endSession(client, target.id));
    sendNoContent(ctx, target.id === principal.session.id ? { 'Set-Cookie': clearedSessionCookie } : {});
  });

  router.post('/api/me/sessions/sign-out-others', async (ctx) => {
    requireXRequestedWith(ctx);
    const principal = requireActive(await resolveCaller(ctx));
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, []);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const ended = await transaction(async (client) => endOtherSessions(client, principal.user.id, principal.session.id));
    sendJson(ctx, 200, { ended });
  });

  router.put('/api/me/password', async (ctx) => {
    const principal = requireActive(await resolveCaller(ctx));
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['current_password', 'new_password']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    await checkSignInThrottle(principal.user.email);
    requireXRequestedWith(ctx);
    requireStringFields(body, ['current_password', 'new_password']);
    const stored = await query<{ password_hash: string }>('select password_hash from users where id = $1', [principal.user.id]);
    if (!verifyPassword(body.current_password as string, stored[0].password_hash)) {
      await recordSignInFailure(principal.user.email);
      throw apiError('invalid_credentials', 'Your current password is incorrect.');
    }
    const next = body.new_password as string;
    if (!isValidNewPassword(next) || next === body.current_password) throw validation({ new_password: passwordMessage });
    const changedAt = nowSecond();
    const ended = await transaction(async (client) => {
      await client.query('update users set password_hash = $2 where id = $1', [principal.user.id, hashPassword(next)]);
      const count = await endOtherSessions(client, principal.user.id, principal.session.id);
      await appendAuditForUser(client, principal.user.id, {
        actor: principal.user.email,
        action: 'password.changed',
        target: principal.user.email,
        detail: '',
      });
      await mailPasswordChanged(client, principal.user.email, changedAt, count);
      return count;
    });
    await clearSignInFailures(principal.user.email);
    sendJson(ctx, 200, { ended_sessions: ended });
  });
}
