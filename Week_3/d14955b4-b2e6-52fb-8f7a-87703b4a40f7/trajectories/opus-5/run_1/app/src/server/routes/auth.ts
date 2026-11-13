import { config } from '../config';
import { one } from '../db';
import { ApiError, validation } from '../errors';
import { FIELD } from '../../shared/copy';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  inspectRefreshToken,
  requireChangeToken,
  requireSession,
  revokeAccessToken,
  revokeFamily,
  rotateRefreshToken,
  startFamily,
  verifyPassword,
  type IssuedSession,
} from '../auth';
import { findGameById } from '../data/games';
import { appendCookie, parseCookies, sendEmpty, sendJson, serialiseCookie, type Ctx, type Router } from '../http';
import { readJsonBody } from './body';
import type { SessionBody, StaffRole } from '../../shared/types';

function setSessionCookies(ctx: Ctx, issued: IssuedSession): void {
  appendCookie(
    ctx.res,
    serialiseCookie(ACCESS_COOKIE, issued.accessToken, {
      path: ACCESS_COOKIE_PATH,
      maxAgeSeconds: config.accessTokenTtlSeconds,
    }),
  );
  appendCookie(
    ctx.res,
    serialiseCookie(REFRESH_COOKIE, issued.refreshToken, {
      path: REFRESH_COOKIE_PATH,
      maxAgeSeconds: config.refreshFamilyTtlSeconds,
    }),
  );
}

function clearSessionCookies(ctx: Ctx): void {
  appendCookie(ctx.res, serialiseCookie(ACCESS_COOKIE, '', { path: ACCESS_COOKIE_PATH, maxAgeSeconds: 0 }));
  appendCookie(ctx.res, serialiseCookie(REFRESH_COOKIE, '', { path: REFRESH_COOKIE_PATH, maxAgeSeconds: 0 }));
}

async function sessionBody(
  staff: { id: string; name: string; email: string; role: StaffRole; game_id: string },
  changeToken: string,
): Promise<SessionBody> {
  const game = await findGameById(staff.game_id);
  return {
    user: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
    game: { slug: game?.slug ?? '', name: game?.name ?? '' },
    change_token: changeToken,
  };
}

export function registerAuthRoutes(router: Router): void {
  router.add('POST', '/api/auth/login', async (ctx) => {
    const body = await readJsonBody(ctx);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fields: Record<string, string> = {};
    if (email === '') fields.email = FIELD.email;
    if (password === '') fields.password = FIELD.password;
    if (Object.keys(fields).length > 0) throw validation(fields);

    const staff = await one<{
      id: string;
      game_id: string;
      name: string;
      email: string;
      role: StaffRole;
      password_hash: string;
    }>(`SELECT id, game_id, name, email, role, password_hash FROM staff WHERE lower(email) = lower($1)`, [email]);
    if (!staff || !(await verifyPassword(password, staff.password_hash))) {
      throw new ApiError(401, 'invalid_credentials');
    }
    const issued = await startFamily(staff.id);
    setSessionCookies(ctx, issued);
    sendJson(ctx, 200, await sessionBody(staff, issued.changeToken));
  });

  router.add('GET', '/api/auth/session', async (ctx) => {
    const session = await requireSession(ctx);
    sendJson(
      ctx,
      200,
      await sessionBody(
        {
          id: session.caller.staffId,
          name: session.caller.name,
          email: session.email,
          role: session.caller.role,
          game_id: session.caller.gameId,
        },
        session.changeToken,
      ),
    );
  });

  router.add('POST', '/api/auth/refresh', async (ctx) => {
    const cookies = parseCookies(ctx.req);
    const raw = cookies[REFRESH_COOKIE];
    const outcome = await inspectRefreshToken(raw);
    const given = ctx.req.headers['x-change-token'];
    if (typeof given !== 'string' || given !== outcome.changeToken) {
      throw new ApiError(403, 'change_refused');
    }
    const issued = await rotateRefreshToken(raw as string, outcome);
    setSessionCookies(ctx, issued);
    const staff = await one<{
      id: string;
      game_id: string;
      name: string;
      email: string;
      role: StaffRole;
    }>(`SELECT id, game_id, name, email, role FROM staff WHERE id = $1`, [outcome.staffId]);
    if (!staff) throw new ApiError(401, 'unauthenticated');
    sendJson(ctx, 200, await sessionBody(staff, issued.changeToken));
  });

  router.add('POST', '/api/auth/logout', async (ctx) => {
    const session = await requireSession(ctx);
    requireChangeToken(ctx, session);
    await revokeAccessToken(session.jti, new Date(Date.now() + config.accessTokenTtlSeconds * 1000));
    await revokeFamily(session.familyId);
    clearSessionCookies(ctx);
    sendEmpty(ctx, 204);
  });
}
